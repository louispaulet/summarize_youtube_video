import unittest

from app.main import (
    SUMMARY_PROMPT,
    choose_transcript,
    extract_video_id,
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


if __name__ == "__main__":
    unittest.main()
