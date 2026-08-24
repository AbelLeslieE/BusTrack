"""Create the non-destructive Bus Pass table for existing BusTrack installs."""

from pathlib import Path
import sys

from sqlalchemy import inspect, text

PROJECT_DIR = Path(__file__).resolve().parents[2]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

import backend.models  # noqa: E402, F401
from backend.database import Base, engine  # noqa: E402


def migrate() -> None:
    """Create only the new table and indexes; no existing data is changed."""

    inspector = inspect(engine)
    if "bus_passes" not in inspector.get_table_names():
        Base.metadata.tables["bus_passes"].create(bind=engine, checkfirst=True)
        print("[ADD] bus_passes table created.")
    else:
        columns = {column["name"] for column in inspector.get_columns("bus_passes")}
        if "validity_period" not in columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE bus_passes "
                    "ADD COLUMN validity_period VARCHAR(20) NOT NULL DEFAULT 'One Year'"
                ))
            print("[ADD] validity_period column created.")
        else:
            print("[SKIP] bus_passes already up to date.")
    print("Bus Pass migration completed successfully.")


if __name__ == "__main__":
    migrate()
