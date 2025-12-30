"""Pydantic models for query operations."""

from pydantic import BaseModel
from typing import List


class QueryRequest(BaseModel):
    question: str


class Source(BaseModel):
    filename: str
    code: str
    language: str
    start_line: int
    end_line: int
    similarity: float


class QueryResponse(BaseModel):
    answer: str
    sources: List[Source]
