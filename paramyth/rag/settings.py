from dataclasses import dataclass
import os
from pathlib import Path

from .identity import MODEL_NAME, EMBEDDING_DIMENSIONS


@dataclass(frozen=True)
class Settings:
    database_path: str
    embedding_model: str = MODEL_NAME
    embedding_dimensions: int = EMBEDDING_DIMENSIONS

    def __post_init__(self):
        if (self.embedding_model, self.embedding_dimensions) != (MODEL_NAME, EMBEDDING_DIMENSIONS):
            raise ValueError('Unsupported embedding configuration; rebuild with the current encoder')

    @classmethod
    def from_environment(cls):
        from dotenv import load_dotenv
        load_dotenv(Path.cwd() / '.env', override=False)
        path = Path(os.getenv('PARAMYTH_RAG_DATABASE', 'data/literary_rag.db')).resolve()
        return cls(str(path))
