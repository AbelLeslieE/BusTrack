"""Operational notification and driver-feedback API."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, Driver, FleetNotification, Route, User
from backend.routes.models_tracking import LiveTrip
from backend.schemas import NotificationFeedbackCreate, NotificationStatusUpdate
from backend.security import require_authenticated, require_driver, require_management, normalized_role
from backend.roles import ROLE_ADMIN, ROLE_DRIVER


router = APIRouter(prefix="/api/notifications", tags=["Notifications"])

FEEDBACK_DETAILS = {
    "traffic": ("Traffic incident reported", "High"),
    "breakdown": ("Bus breakdown reported", "Critical"),
    "accident": ("Accident reported", "Critical"),
    "medical": ("Medical assistance requested", "Critical"),
    "delay": ("Route delay reported", "Medium"),
    "other": ("Driver operational feedback", "Medium"),
}
VALID_STATUSES = {"Open", "Acknowledged", "Resolved"}


def _serialize(notification: FleetNotification, db: Session) -> dict:
    driver = db.get(Driver, notification.driver_id) if notification.driver_id else None
    bus = db.get(Bus, notification.bus_id) if notification.bus_id else None
    route = db.get(Route, notification.route_id) if notification.route_id else None
    return {
        "id": notification.id,
        "feedback_type": notification.feedback_type,
        "title": notification.title,
        "message": notification.message,
        "severity": notification.severity,
        "status": notification.status,
        "driver_id": notification.driver_id,
        "driver_name": driver.user.full_name if driver and driver.user else None,
        "driver_code": driver.driver_code if driver else None,
        "bus_id": notification.bus_id,
        "bus_number": bus.bus_number if bus else None,
        "route_id": notification.route_id,
        "route_name": route.route_name if route else None,
        "route_code": route.route_code if route else None,
        "trip_id": notification.trip_id,
        "acknowledged_by": notification.acknowledged_by,
        "acknowledged_at": notification.acknowledged_at,
        "created_at": notification.created_at,
        "updated_at": notification.updated_at,
    }


def _scoped_query(current_user: User, db: Session):
    query = db.query(FleetNotification)
    role = normalized_role(current_user)
    if role == ROLE_ADMIN:
        return query
    if role == ROLE_DRIVER:
        driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
        if driver is None:
            raise HTTPException(status_code=403, detail="Driver profile not found.")
        return query.filter(FleetNotification.driver_id == driver.id)
    raise HTTPException(status_code=403, detail="Notification access is not available for this role.")


@router.get("")
def list_notifications(
    limit: int = Query(default=100, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    current_user: User = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """List management notifications or the authenticated driver's own feedback."""

    if status_filter is not None and status_filter not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid notification status.")
    query = _scoped_query(current_user, db)
    if status_filter:
        query = query.filter(FleetNotification.status == status_filter)
    notifications = query.order_by(FleetNotification.created_at.desc()).limit(limit).all()
    open_count = _scoped_query(current_user, db).filter(FleetNotification.status == "Open").count()
    return {
        "notifications": [_serialize(item, db) for item in notifications],
        "total": len(notifications),
        "open_count": open_count,
    }


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
def create_driver_feedback(
    feedback: NotificationFeedbackCreate,
    current_user: User = Depends(require_driver),
    db: Session = Depends(get_db),
):
    """Create a feedback notification for the driver's currently running trip."""

    driver = db.query(Driver).filter(Driver.user_id == current_user.id).first()
    if driver is None:
        raise HTTPException(status_code=403, detail="Driver profile not found.")
    trip = (
        db.query(LiveTrip)
        .filter(LiveTrip.driver_id == driver.id, LiveTrip.ended_at.is_(None))
        .order_by(LiveTrip.started_at.desc())
        .first()
    )
    # Feedback is available from the live-tracking workspace even before the
    # driver starts GPS. When a trip is running, its exact bus and route are
    # recorded; otherwise the driver's current central assignment is used.
    assigned_route = None
    if trip is None:
        assigned_route = db.query(Route).filter(Route.driver_id == driver.id).first()

    now = datetime.now(timezone.utc)
    recent_feedback = (
        db.query(FleetNotification)
        .filter(
            FleetNotification.driver_id == driver.id,
            FleetNotification.created_at >= now - timedelta(seconds=10),
        )
        .first()
    )
    if recent_feedback is not None:
        raise HTTPException(status_code=429, detail="Please wait a few seconds before sending another alert.")

    title, severity = FEEDBACK_DETAILS[feedback.feedback_type]
    notification = FleetNotification(
        feedback_type=feedback.feedback_type,
        title=title,
        message=feedback.message.strip() if feedback.message and feedback.message.strip() else None,
        severity=severity,
        status="Open",
        driver_id=driver.id,
        bus_id=trip.bus_id if trip else driver.bus_id,
        route_id=trip.route_id if trip else (assigned_route.id if assigned_route else None),
        trip_id=trip.id if trip else None,
        created_at=now,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return {"message": "Feedback sent to the admin team.", "notification": _serialize(notification, db)}


@router.patch("/{notification_id}")
def update_notification_status(
    notification_id: int,
    update: NotificationStatusUpdate,
    current_user: User = Depends(require_management),
    db: Session = Depends(get_db),
):
    """Acknowledge or resolve a driver notification from the management console."""

    notification = db.get(FleetNotification, notification_id)
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    notification.status = update.status
    if update.status == "Open":
        notification.acknowledged_by = None
        notification.acknowledged_at = None
    else:
        notification.acknowledged_by = current_user.id
        notification.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(notification)
    return _serialize(notification, db)
