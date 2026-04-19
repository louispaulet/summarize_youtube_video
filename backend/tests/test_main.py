import unittest

from app.main import SUMMARY_PROMPT, extract_video_id


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


if __name__ == "__main__":
    unittest.main()
