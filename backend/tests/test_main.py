import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from requests import Timeout as RequestsTimeout
from youtube_transcript_api import RequestBlocked

from app.main import (
    SUMMARY_PROMPT,
    choose_transcript,
    error_detail,
    extract_video_id,
    get_transcript_text,
    summarize_transcript,
    transcript_priority,
)


class FakeTranscript:
    def __init__(
        self,
        language_code: str,
        *,
        is_generated: bool = False,
        is_translatable: bool = False,
    ) -> None:
        self.language_code = language_code
        self.is_generated = is_generated
        self.is_translatable = is_translatable
        self.translated_to = None

    def translate(self, language_code: str):
        clone = FakeTranscript(
            language_code=language_code,
            is_generated=self.is_generated,
            is_translatable=self.is_translatable,
        )
        clone.translated_to = language_code
        return clone


class ExtractVideoIdTests(unittest.TestCase):
    def test_watch_url(self) -> None:
        self.assertEqual(
            extract_video_id("https://www.youtube.com/watch?v=abc123xyz89"),
            "abc123xyz89",
        )

    def test_short_url(self) -> None:
        self.assertEqual(
            extract_video_id("https://youtu.be/abc123xyz89"),
            "abc123xyz89",
        )

    def test_embed_url(self) -> None:
        self.assertEqual(
            extract_video_id("https://www.youtube.com/embed/abc123xyz89"),
            "abc123xyz89",
        )

    def test_invalid_url(self) -> None:
        self.assertIsNone(extract_video_id("https://example.com/video"))


class SummaryPromptTests(unittest.TestCase):
    def test_prompt_requires_english_output(self) -> None:
        self.assertIn("Always write the recap in English.", SUMMARY_PROMPT)


class ErrorDetailTests(unittest.TestCase):
    def test_returns_machine_readable_error_payload(self) -> None:
        self.assertEqual(
            error_detail("caption_api_timed_out", "The caption API timed out."),
            {
                "error_code": "caption_api_timed_out",
                "message": "The caption API timed out.",
            },
        )


class TranscriptSelectionTests(unittest.TestCase):
    def test_priority_prefers_english_then_manual_then_auto(self) -> None:
        transcripts = [
            FakeTranscript("fr", is_generated=True, is_translatable=True),
            FakeTranscript("en", is_generated=True, is_translatable=True),
            FakeTranscript("fr", is_generated=False, is_translatable=True),
            FakeTranscript("en", is_generated=False, is_translatable=True),
        ]

        ranked = sorted(transcripts, key=transcript_priority)

        self.assertEqual(
            [(item.language_code, item.is_generated) for item in ranked],
            [("en", False), ("fr", False), ("en", True), ("fr", True)],
        )

    def test_choose_transcript_translates_non_english_when_possible(self) -> None:
        chosen = choose_transcript(
            FakeTranscript("fr", is_generated=False, is_translatable=True)
        )

        self.assertEqual(chosen.language_code, "en")
        self.assertEqual(chosen.translated_to, "en")


class TranscriptFailureTests(unittest.TestCase):
    @patch("app.main.select_transcript")
    def test_returns_timeout_error_code_when_caption_api_times_out(
        self, mock_select_transcript: MagicMock
    ) -> None:
        mock_select_transcript.return_value.fetch.side_effect = RequestsTimeout(
            "caption fetch timed out"
        )

        with self.assertRaises(HTTPException) as context:
            get_transcript_text("abc123xyz89")

        self.assertEqual(context.exception.status_code, 504)
        self.assertEqual(
            context.exception.detail["error_code"],
            "caption_api_timed_out",
        )

    @patch("app.main.select_transcript")
    def test_returns_rate_limit_error_code_when_caption_api_is_blocked(
        self, mock_select_transcript: MagicMock
    ) -> None:
        mock_select_transcript.return_value.fetch.side_effect = RequestBlocked(
            "abc123xyz89"
        )

        with self.assertRaises(HTTPException) as context:
            get_transcript_text("abc123xyz89")

        self.assertEqual(context.exception.status_code, 429)
        self.assertEqual(
            context.exception.detail["error_code"],
            "caption_api_rate_limited",
        )


class SummarizationFailureTests(unittest.TestCase):
    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}, clear=False)
    @patch("app.main.OpenAI")
    def test_returns_llm_not_available_when_openai_call_fails(
        self, mock_openai: MagicMock
    ) -> None:
        mock_openai.return_value.responses.create.side_effect = RuntimeError("boom")

        with self.assertRaises(HTTPException) as context:
            summarize_transcript("hello world")

        self.assertEqual(context.exception.status_code, 502)
        self.assertEqual(
            context.exception.detail["error_code"],
            "llm_not_available",
        )


if __name__ == "__main__":
    unittest.main()
