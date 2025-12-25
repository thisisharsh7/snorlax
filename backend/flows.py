"""
CocoIndex flow definitions for code embedding and indexing.
"""

import cocoindex
from cocoindex.sources import LocalFile
from cocoindex.functions import (
    DetectProgrammingLanguage,
    SplitRecursively,
    SentenceTransformerEmbed
)
from cocoindex.targets import Postgres
from cocoindex.index import VectorIndexDef, VectorSimilarityMetric
from numpy.typing import NDArray
import numpy as np
import os
from dotenv import load_dotenv

load_dotenv()

# Initialize CocoIndex settings
# Using APP_DATABASE_URL for both CocoIndex internal tables and application data
cocoindex.init(
    cocoindex.Settings(
        app_namespace="codeqa",
        database=cocoindex.DatabaseConnectionSpec(
            url=os.getenv("APP_DATABASE_URL")
        )
    )
)

# Shared embedding function - CRITICAL for query consistency
# This same function is used for both indexing and querying
@cocoindex.transform_flow()
def code_to_embedding(
    text: cocoindex.DataSlice[str]
) -> cocoindex.DataSlice[NDArray[np.float32]]:
    """
    Convert code text to embeddings using SentenceTransformers.
    This function MUST be used for both indexing and querying to ensure consistency.

    Model: sentence-transformers/all-MiniLM-L6-v2
    - Fast and efficient
    - 384 dimensions
    - Good for code and text
    """
    return text.transform(
        SentenceTransformerEmbed(
            model="sentence-transformers/all-MiniLM-L6-v2"
        )
    )


def create_flow_for_project(project_id: str, repo_path: str):
    """
    Dynamically create a CocoIndex flow for a specific project.

    Args:
        project_id: Unique identifier for the project
        repo_path: Path to the cloned repository

    Returns:
        CocoIndex flow function
    """

    @cocoindex.flow_def(name=f"flow_{project_id.replace('-', '_')}")
    def code_embedding_flow(
        flow_builder: cocoindex.FlowBuilder,
        data_scope: cocoindex.DataScope
    ):
        # SOURCE: Read code files from cloned repository
        data_scope["files"] = flow_builder.add_source(
            LocalFile(
                path=repo_path,
                included_patterns=[
                    "*.py",   # Python
                    "*.js",   # JavaScript
                    "*.ts",   # TypeScript
                    "*.tsx",  # TypeScript React
                    "*.jsx",  # JavaScript React
                    "*.java", # Java
                    "*.go",   # Go
                    "*.rs",   # Rust
                    "*.c",    # C
                    "*.cpp",  # C++
                    "*.rb",   # Ruby
                    "*.php",  # PHP
                    "*.md",   # Markdown
                ],
                excluded_patterns=[
                    ".*",              # Hidden files/folders
                    "node_modules",    # Node dependencies
                    "__pycache__",     # Python cache
                    "venv",            # Python virtual env
                    "env",             # Python env
                    "target",          # Rust/Java build
                    "build",           # Build directories
                    "dist",            # Distribution
                    ".git",            # Git directory
                    "vendor",          # Vendor dependencies
                ]
            )
        )

        # COLLECTOR: Prepare to collect processed embeddings
        embeddings_collector = data_scope.add_collector()

        # PROCESS: For each file in the repository
        with data_scope["files"].row() as file:
            # Detect programming language from filename
            file["language"] = file["filename"].transform(
                DetectProgrammingLanguage()
            )

            # Split file content into chunks
            # Uses language-aware splitting for better chunk boundaries
            file["chunks"] = file["content"].transform(
                SplitRecursively(),
                language=file["language"],  # Language-aware splitting
                chunk_size=1000,            # 1000 bytes per chunk
                chunk_overlap=300,          # 300 bytes overlap (30%)
                min_chunk_size=300          # Skip chunks smaller than 300 bytes
            )

            # For each chunk, generate embeddings
            with file["chunks"].row() as chunk:
                # Generate embedding using shared function
                chunk["embedding"] = chunk["text"].call(code_to_embedding)

                # Collect results for export
                # Extract line numbers from location objects
                embeddings_collector.collect(
                    filename=file["filename"],
                    location=chunk["location"],
                    code=chunk["text"],
                    embedding=chunk["embedding"],
                    language=file["language"],
                    start_line=chunk["start"]["line"],
                    end_line=chunk["end"]["line"]
                )

        # EXPORT: Save embeddings to Postgres with vector index
        embeddings_collector.export(
            f"embeddings_{project_id.replace('-', '_')}",
            Postgres(
                table_name=f"embeddings_{project_id.replace('-', '_')}"
            ),
            primary_key_fields=["filename", "location"],
            vector_indexes=[
                VectorIndexDef(
                    field_name="embedding",
                    metric=VectorSimilarityMetric.COSINE_SIMILARITY
                )
            ]
        )

    return code_embedding_flow
