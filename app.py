"""
Cloud-Based Language Translation Service
----------------------------------------
Flask application exposing a REST API + dashboard for AI-powered
document translation: upload -> auto-detect language -> translate -> download.
"""

import os
import time

from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

from services import document_processor as docs
from services.translation_service import TranslationService

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB upload cap

translation_service = TranslationService()


# ---------------------------------------------------------------------- #
# Pages
# ---------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------- #
# REST API
# ---------------------------------------------------------------------- #
@app.route("/api/languages")
def api_languages():
    """List all languages supported by the translation cloud backend."""
    return jsonify({"languages": translation_service.get_languages()})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    """Accept a document, extract its text and auto-detect the language."""
    if "file" not in request.files or request.files["file"].filename == "":
        return jsonify({"error": "No file was uploaded."}), 400

    file = request.files["file"]
    filename = secure_filename(file.filename)
    if not docs.allowed_file(filename):
        return jsonify({
            "error": "Unsupported file type. Allowed: "
                     + ", ".join(sorted(docs.ALLOWED_EXTENSIONS))
        }), 400

    try:
        text = docs.extract_text(file.stream, docs.get_extension(filename))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "Failed to read the document. It may be corrupted."}), 400

    if not text.strip():
        return jsonify({"error": "No readable text found in this document "
                                 "(scanned/image-only PDFs are not supported)."}), 400

    detection = translation_service.detect_language(text)
    return jsonify({
        "filename": filename,
        "text": text,
        "detected": detection,
        "stats": {
            "characters": len(text),
            "words": len(text.split()),
            "lines": text.count("\n") + 1,
        },
    })


@app.route("/api/detect", methods=["POST"])
def api_detect():
    """Auto-detect the language of raw text (for pasted/edited content)."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    if not text.strip():
        return jsonify({"error": "No text provided."}), 400
    return jsonify({"detected": translation_service.detect_language(text)})


@app.route("/api/translate", methods=["POST"])
def api_translate():
    """Translate text into the requested target language."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    target = data.get("target", "")
    source = data.get("source", "auto") or "auto"

    if not text.strip():
        return jsonify({"error": "There is no text to translate."}), 400
    if not target:
        return jsonify({"error": "Please choose a target language."}), 400

    started = time.time()
    try:
        translated = translation_service.translate(text, target=target, source=source)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "Translation cloud service is unreachable. "
                                 "Check your internet connection and try again."}), 502

    return jsonify({
        "translated": translated,
        "target": target,
        "target_name": translation_service.language_name(target),
        "elapsed": round(time.time() - started, 2),
        "stats": {
            "characters": len(translated),
            "words": len(translated.split()),
        },
    })


@app.route("/api/download", methods=["POST"])
def api_download():
    """Package translated text as a downloadable .txt or .docx file."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    fmt = data.get("format", "txt")
    base = os.path.splitext(secure_filename(data.get("filename") or "document"))[0]
    lang = data.get("target", "translated")

    if not text.strip():
        return jsonify({"error": "Nothing to download yet."}), 400

    if fmt == "docx":
        buffer = docs.build_docx(text)
        mimetype = ("application/vnd.openxmlformats-officedocument"
                    ".wordprocessingml.document")
        name = f"{base}_{lang}.docx"
    else:
        buffer = docs.build_txt(text)
        mimetype = "text/plain"
        name = f"{base}_{lang}.txt"

    return send_file(buffer, mimetype=mimetype, as_attachment=True, download_name=name)


@app.errorhandler(413)
def too_large(_):
    return jsonify({"error": "File is too large. Maximum size is 16 MB."}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)
