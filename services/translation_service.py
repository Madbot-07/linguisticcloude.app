"""
Translation Service
-------------------
AI-powered language detection (langdetect) and neural machine translation
via the Google Translate cloud backend (deep-translator). Handles chunking
so documents of any length can be translated within API limits.
"""

from deep_translator import GoogleTranslator
from langdetect import detect_langs, DetectorFactory, LangDetectException

# Deterministic detection results
DetectorFactory.seed = 0

# Max characters per translation request (API hard limit is 5000)
CHUNK_SIZE = 4500

# langdetect ISO codes that differ from Google Translate codes
CODE_FIXES = {
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
    "he": "iw",
    "fil": "tl",
    "nb": "no",
}


class TranslationService:
    def __init__(self):
        # {'english': 'en', 'french': 'fr', ...}
        self._name_to_code = GoogleTranslator().get_supported_languages(as_dict=True)
        self._code_to_name = {code: name for name, code in self._name_to_code.items()}

    # ------------------------------------------------------------------ #
    # Languages
    # ------------------------------------------------------------------ #
    def get_languages(self):
        """Return supported languages as [{code, name}, ...] sorted by name."""
        languages = [
            {"code": code, "name": name.title()}
            for name, code in self._name_to_code.items()
        ]
        return sorted(languages, key=lambda item: item["name"])

    def language_name(self, code: str) -> str:
        return self._code_to_name.get(code, code).title()

    # ------------------------------------------------------------------ #
    # AI language detection
    # ------------------------------------------------------------------ #
    def detect_language(self, text: str) -> dict:
        """Detect the dominant language of a text sample with confidence."""
        sample = text.strip()[:5000]
        if not sample:
            return {"code": "unknown", "name": "Unknown", "confidence": 0.0}
        try:
            candidates = detect_langs(sample)
        except LangDetectException:
            return {"code": "unknown", "name": "Unknown", "confidence": 0.0}

        best = candidates[0]
        code = CODE_FIXES.get(best.lang, best.lang)
        return {
            "code": code,
            "name": self.language_name(code),
            "confidence": round(best.prob * 100, 1),
            "alternatives": [
                {
                    "code": CODE_FIXES.get(c.lang, c.lang),
                    "name": self.language_name(CODE_FIXES.get(c.lang, c.lang)),
                    "confidence": round(c.prob * 100, 1),
                }
                for c in candidates[1:3]
            ],
        }

    # ------------------------------------------------------------------ #
    # Translation
    # ------------------------------------------------------------------ #
    def translate(self, text: str, target: str, source: str = "auto") -> str:
        """Translate text of any length by chunking at line boundaries."""
        if target not in self._code_to_name:
            raise ValueError(f"Unsupported target language: {target}")
        if source != "auto" and source not in self._code_to_name:
            source = "auto"

        translator = GoogleTranslator(source=source, target=target)
        translated_chunks = []
        for chunk in self._chunk_text(text):
            if chunk.strip():
                translated_chunks.append(translator.translate(chunk) or "")
            else:
                translated_chunks.append(chunk)
        return "\n".join(translated_chunks)

    @staticmethod
    def _chunk_text(text: str):
        """Split text into chunks under CHUNK_SIZE, preserving line breaks."""
        chunks = []
        current_lines = []
        current_len = 0

        for line in text.split("\n"):
            # Hard-split single lines that exceed the limit on their own
            while len(line) > CHUNK_SIZE:
                split_at = line.rfind(" ", 0, CHUNK_SIZE)
                if split_at <= 0:
                    split_at = CHUNK_SIZE
                head, line = line[:split_at], line[split_at:].lstrip()
                if current_lines:
                    chunks.append("\n".join(current_lines))
                    current_lines, current_len = [], 0
                chunks.append(head)

            if current_len + len(line) + 1 > CHUNK_SIZE and current_lines:
                chunks.append("\n".join(current_lines))
                current_lines, current_len = [], 0
            current_lines.append(line)
            current_len += len(line) + 1

        if current_lines:
            chunks.append("\n".join(current_lines))
        return chunks
