"""
BusTrack
LiveTrip Stop-State Migration

Adds persistent route-stop tracking fields to live_trips.

IMPORTANT:
This migration does NOT delete or recreate the database.
"""

from pathlib import Path
import sys

from sqlalchemy import inspect, text


# ==========================================================
# PROJECT PATH
# ==========================================================

# Get the BusTrack project root:
#
# database/
#   migrations/
#       this_file.py
#
# Therefore:
# parents[0] = migrations
# parents[1] = database
# parents[2] = bus-tracker
#
PROJECT_DIR = Path(__file__).resolve().parents[2]

if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))


# ==========================================================
# DATABASE
# ==========================================================

from backend.database import engine
# ==========================================================
# REQUIRED COLUMNS
# ==========================================================

REQUIRED_COLUMNS = {
    "current_route_stop_id": """
        INTEGER
        REFERENCES route_stops(id)
    """,

    "current_stop_status": """
        VARCHAR(20)
        DEFAULT 'Approaching'
    """,

    "current_stop_arrived_at": """
        TIMESTAMP
    """,

    "current_stop_departed_at": """
        TIMESTAMP
    """,
}


# ==========================================================
# MIGRATION
# ==========================================================

def migrate() -> None:

    inspector = inspect(
        engine
    )


    # ------------------------------------------------------
    # Make sure the live_trips table exists.
    # ------------------------------------------------------

    tables = inspector.get_table_names()

    if "live_trips" not in tables:

        raise RuntimeError(
            "The live_trips table does not exist. "
            "Initialize the database before running this migration."
        )


    # ------------------------------------------------------
    # Read existing columns.
    # ------------------------------------------------------

    existing_columns = {
        column["name"]
        for column in
        inspector.get_columns(
            "live_trips"
        )
    }


    # ------------------------------------------------------
    # Add only missing columns.
    # ------------------------------------------------------

    with engine.begin() as connection:

        for column_name, column_definition in (
            REQUIRED_COLUMNS.items()
        ):

            if column_name in existing_columns:

                print(
                    f"[SKIP] {column_name} already exists."
                )

                continue


            statement = text(
                f"""
                ALTER TABLE live_trips
                ADD COLUMN
                {column_name}
                {column_definition}
                """
            )


            connection.execute(
                statement
            )


            print(
                f"[ADD] {column_name}"
            )


    print(
        "\nLiveTrip stop-state migration completed successfully."
    )


# ==========================================================
# ENTRY POINT
# ==========================================================

if __name__ == "__main__":

    migrate()