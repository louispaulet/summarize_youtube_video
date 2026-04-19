import os
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError
from pydantic import BaseModel, Field
from requests import Timeout as RequestsTimeout
from youtube_transcript_api import (
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
    YouTubeRequestFailed,
)

ROOT_DIR = Path(__file__).resolve().parents[2]

# Prefer the shared repo-level .env while still allowing the legacy backend/.env file.
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

SUMMARY_PROMPT = (
    "Summarize the YouTube video from the transcript below. "
    "Always write the recap in English. "
    "Return Markdown only. "
    "Start with exactly 3 executive takeaway bullet points. "
    "Then write 3 succinct paragraphs labeled Intro, Development, and Conclusion."
)


class SummarizeRequest(BaseModel):
    youtube_url: str = Field(..., min_length=1)


class SummarizeResponse(BaseModel):
    summary_markdown: str
    video_id: str


app = FastAPI(title="YouTube Video Summarizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


def extract_video_id(youtube_url: str) -> Optional[str]:
    parsed = urlparse(youtube_url.strip())
    hostname = (parsed.hostname or "").lower()

    if hostname in {"youtu.be", "www.youtu.be"}:
        return parsed.path.lstrip("/") or None

    if hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        if parsed.path.startswith("/shorts/") or parsed.path.startswith("/embed/"):
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2:
                return parts[1]

    return None


def error_detail(code: str, message: str) -> dict[str, str]:
    return {
        "error_code": code,
        "message": message,
    }


def transcript_priority(transcript) -> tuple[int, int, str]:
    language_code = getattr(transcript, "language_code", "") or ""
    is_generated = bool(getattr(transcript, "is_generated", False))
    is_english = language_code.startswith("en")

    if is_english and not is_generated:
        return (0, 0, language_code)
    if not is_english and not is_generated:
        return (1, 0, language_code)
    if is_english and is_generated:
        return (2, 0, language_code)
    return (3, 0, language_code)


def choose_transcript(transcript):
    language_code = getattr(transcript, "language_code", "") or ""
    is_english = language_code.startswith("en")
    if is_english or not getattr(transcript, "is_translatable", False):
        return transcript
    return transcript.translate("en")


def select_transcript(video_id: str):
    transcript_list = list(YouTubeTranscriptApi().list(video_id))

    if not transcript_list:
        raise NoTranscriptFound(video_id, [], transcript_list)

    ranked_transcripts = sorted(transcript_list, key=transcript_priority)
    return choose_transcript(ranked_transcripts[0])


def get_transcript_text(video_id: str) -> str:
    try:
        transcript = select_transcript(video_id).fetch()
    except TranscriptsDisabled as exc:
        raise HTTPException(
            status_code=422,
            detail="Transcripts are disabled for this video.",
        ) from exc
    except NoTranscriptFound as exc:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "transcript_not_found",
                "No transcript was found for this video.",
            ),
        ) from exc
    except RequestsTimeout as exc:
        raise HTTPException(
            status_code=504,
            detail=error_detail(
                "caption_api_timed_out",
                "The caption API timed out while fetching the transcript.",
            ),
        ) from exc
    except RequestBlocked as exc:
        raise HTTPException(
            status_code=429,
            detail=error_detail(
                "caption_api_rate_limited",
                "The caption API rate limited transcript requests.",
            ),
        ) from exc
    except YouTubeRequestFailed as exc:
        reason = str(getattr(exc, "reason", "") or "").lower()
        if "429" in reason or "too many requests" in reason:
            raise HTTPException(
                status_code=429,
                detail=error_detail(
                    "caption_api_rate_limited",
                    "The caption API rate limited transcript requests.",
                ),
            ) from exc
        if "timed out" in reason or "timeout" in reason:
            raise HTTPException(
                status_code=504,
                detail=error_detail(
                    "caption_api_timed_out",
                    "The caption API timed out while fetching the transcript.",
                ),
            ) from exc
        raise HTTPException(
            status_code=502,
            detail=error_detail(
                "transcript_fetch_failed",
                "Failed to fetch the YouTube transcript.",
            ),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail(
                "transcript_fetch_failed",
                "Failed to fetch the YouTube transcript.",
            ),
        ) from exc

    transcript_text = " ".join(
        segment.text.strip()
        for segment in transcript
        if getattr(segment, "text", "").strip()
    ).strip()

    if not transcript_text:
        raise HTTPException(
            status_code=422,
            detail=error_detail(
                "transcript_empty",
                "The transcript was empty for this video.",
            ),
        )

    return transcript_text


def summarize_transcript(transcript_text: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=error_detail(
                "llm_not_available",
                "OPENAI_API_KEY is missing from the environment.",
            ),
        )

    client = OpenAI(api_key=api_key)

    try:
        response = client.responses.create(
            model="gpt-5-nano",
            instructions=SUMMARY_PROMPT,
            input=transcript_text,
            text={"verbosity": "medium"},
        )
        summary = (response.output_text or "").strip()
    except (APITimeoutError, APIConnectionError) as exc:
        raise HTTPException(
            status_code=503,
            detail=error_detail(
                "llm_not_available",
                "The summarization model is currently unavailable.",
            ),
        ) from exc
    except RateLimitError as exc:
        raise HTTPException(
            status_code=503,
            detail=error_detail(
                "llm_not_available",
                "The summarization model is currently unavailable.",
            ),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=error_detail(
                "llm_not_available",
                "The summarization model is currently unavailable.",
            ),
        ) from exc

    if not summary:
        raise HTTPException(
            status_code=502,
            detail=error_detail(
                "llm_empty_response",
                "OpenAI returned an empty summary.",
            ),
        )

    return summary


@app.get("/health")
def healthcheck() -> dict:
    return {"status": "ok"}


@app.post("/api/summarize", response_model=SummarizeResponse)
def summarize_video(payload: SummarizeRequest) -> SummarizeResponse:
    video_id = extract_video_id(payload.youtube_url)
    if not video_id:
        raise HTTPException(
            status_code=400,
            detail="Please provide a valid YouTube watch, short, embed, or youtu.be URL.",
        )

    transcript_text = get_transcript_text(video_id)
    summary_markdown = summarize_transcript(transcript_text)

    return SummarizeResponse(
        summary_markdown=summary_markdown,
        video_id=video_id,
    )
