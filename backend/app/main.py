import os
from typing import Optional
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field
from youtube_transcript_api import (
    NoTranscriptFound,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

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


def select_transcript(video_id: str):
    transcript_list = YouTubeTranscriptApi().list(video_id)

    try:
        return transcript_list.find_transcript(["en", "en-US", "en-GB"])
    except NoTranscriptFound:
        pass

    for transcript in transcript_list:
        if getattr(transcript, "language_code", "").startswith("en"):
            return transcript

    for transcript in transcript_list:
        if getattr(transcript, "is_translatable", False):
            return transcript.translate("en")

    raise NoTranscriptFound(video_id, [], transcript_list)


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
            detail="No transcript was found for this video.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to fetch the YouTube transcript.",
        ) from exc

    transcript_text = " ".join(
        segment.text.strip()
        for segment in transcript
        if getattr(segment, "text", "").strip()
    ).strip()

    if not transcript_text:
        raise HTTPException(
            status_code=422,
            detail="The transcript was empty for this video.",
        )

    return transcript_text


def summarize_transcript(transcript_text: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is missing from the environment.",
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
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI summarization failed.",
        ) from exc

    if not summary:
        raise HTTPException(
            status_code=502,
            detail="OpenAI returned an empty summary.",
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
