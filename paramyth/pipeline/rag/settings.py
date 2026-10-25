from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path
from ..paths import workspace_root
from dotenv import load_dotenv

@dataclass(frozen=True)
class Settings:
    database_path: str
    embedding_model: str
    embedding_dimensions: int
    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv(workspace_root() / ".env", override=False)
        root = workspace_root()
        database_path = Path(os.getenv("DATABASE_PATH", "data/literary_rag.db"))
        if not database_path.is_absolute():
            database_path = root / database_path
        database_path.parent.mkdir(parents=True, exist_ok=True)
        from paramyth.pipeline.rag.identity import MODEL_NAME, EMBEDDING_DIMENSIONS
        return cls(str(database_path), MODEL_NAME, EMBEDDING_DIMENSIONS)
