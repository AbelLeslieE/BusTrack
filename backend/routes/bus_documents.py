"""Admin-only optional document metadata and protected, bounded uploads."""
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import PurePath
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Bus, FleetNotification
from backend.models_documents import BusDocument, BusDocumentReminder
from backend.security import require_management
from backend.services.bus_documents import DOCUMENT_TYPES, lock_document_writes, serialize_document

router = APIRouter(prefix="/api/buses/{bus_id}/documents", tags=["Bus Documents"])
MAX_FILE_BYTES = 5 * 1024 * 1024


class DocumentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_number: str | None = Field(default=None, max_length=120)
    issue_date: date | None = None
    valid_from: date | None = None
    valid_until: date | None = None
    remarks: str | None = Field(default=None, max_length=4000)
    expected_version: int = Field(default=0, ge=0)
    remove_file: bool = False


def validate_bus(db, bus_id, document_type=None):
    if db.get(Bus, bus_id) is None:
        raise HTTPException(404, "Bus not found.")
    if document_type is not None and document_type not in DOCUMENT_TYPES:
        raise HTTPException(404, "Document type not supported.")


@router.get("")
def list_documents(bus_id: int, db: Session = Depends(get_db), user=Depends(require_management)):
    validate_bus(db, bus_id)
    documents = {item.document_type: item for item in db.scalars(select(BusDocument).where(BusDocument.bus_id == bus_id))}
    return {"bus_id": bus_id, "documents": [serialize_document(documents.get(kind), kind) for kind in DOCUMENT_TYPES]}


async def read_upload(file):
    content = await file.read(MAX_FILE_BYTES + 1)
    if not content or len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "Choose a non-empty document up to 5 MB.")
    extension = PurePath(file.filename or "").suffix.lower()
    if extension == ".pdf" and content.startswith(b"%PDF-"):
        media_type = "application/pdf"
    elif extension in {".jpg", ".jpeg", ".png"}:
        try:
            with Image.open(BytesIO(content)) as image:
                expected = "PNG" if extension == ".png" else "JPEG"
                if image.format != expected or image.width * image.height > 25_000_000:
                    raise ValueError("Invalid image")
                image.verify()
            media_type = "image/png" if extension == ".png" else "image/jpeg"
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise HTTPException(400, "Choose a valid JPG, JPEG or PNG image.") from error
    else:
        raise HTTPException(400, "Only PDF, JPG, JPEG and PNG documents are supported.")
    return content, media_type, extension


@router.put("/{document_type}")
async def save_document(bus_id: int, document_type: str, metadata: Annotated[str, Form()] = "{}",
                        file: UploadFile | None = File(default=None),
                        db: Session = Depends(get_db), user=Depends(require_management)):
    try:
        update = DocumentUpdate.model_validate_json(metadata)
    except ValidationError as error:
        raise HTTPException(422, "Invalid document details. Use valid dates and keep remarks under 4,000 characters.") from error
    # Validate the complete upload before changing metadata; failed uploads are atomic.
    upload = await read_upload(file) if file else None
    lock_document_writes(db)
    validate_bus(db, bus_id, document_type)
    document = db.scalar(select(BusDocument).where(BusDocument.bus_id == bus_id,
                          BusDocument.document_type == document_type).with_for_update())
    if update.expected_version != (document.version if document else 0):
        raise HTTPException(409, "This document changed. Reopen it before saving again.")
    values = update.model_dump(exclude={"expected_version", "remove_file"})
    for key in ("document_number", "remarks"):
        values[key] = values[key].strip() or None if values[key] else None
    if document is None and not upload and not any(values.values()):
        db.rollback()
        return serialize_document(None, document_type)
    if document is None:
        document = BusDocument(bus_id=bus_id, document_type=document_type, version=0)
        db.add(document)
    previous_expiry = document.valid_until
    for key, value in values.items():
        setattr(document, key, value)
    if upload:
        document.file_content, document.file_type, extension = upload
        document.file_name = f"{document_type}{extension}"
    elif update.remove_file:
        document.file_content = document.file_name = document.file_type = None
    document.version += 1
    document.updated_by = user.id
    document.updated_at = datetime.now(timezone.utc)
    try:
        db.flush()
        if previous_expiry != document.valid_until:
            # Retain reminder history, but retire alerts for superseded dates.
            ids = select(BusDocumentReminder.notification_id).where(
                BusDocumentReminder.document_id == document.id,
                BusDocumentReminder.expiry_date != document.valid_until if document.valid_until else True,
            )
            db.query(FleetNotification).filter(FleetNotification.id.in_(ids), FleetNotification.status != "Resolved").update(
                {"status": "Resolved"}, synchronize_session=False)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "This document changed. Reopen it before saving again.") from error
    return serialize_document(document, document_type)


@router.get("/{document_type}/file")
def download_document(bus_id: int, document_type: str, db: Session = Depends(get_db), user=Depends(require_management)):
    validate_bus(db, bus_id, document_type)
    document = db.scalar(select(BusDocument).where(BusDocument.bus_id == bus_id, BusDocument.document_type == document_type))
    if document is None or not document.file_name or not document.file_content:
        raise HTTPException(404, "No file has been added for this document.")
    return Response(document.file_content, media_type=document.file_type, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(document.file_name)}",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
    })
