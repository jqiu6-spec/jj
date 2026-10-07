#!/usr/bin/env python3
"""Minimal stdio MCP server exposing the photo-palette extractor as a tool.

Speaks newline-delimited JSON-RPC 2.0 (the MCP stdio transport) with no
dependencies beyond the extractor's own (Pillow and NumPy).
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "skills" / "photo-palette" / "scripts"))

import palette as P  # noqa: E402

SERVER_INFO = {"name": "photo-palette", "version": P.__version__}
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

EXTRACT_TOOL = {
    "name": "extract_palette",
    "title": "Extract color palette",
    "description": (
        "Generate a clean, perceptually balanced color palette from a photograph or "
        "image file. Clusters colors in OKLab, restores the saturation that averaging "
        "loses, drops edge-blend and near-duplicate colors, and assigns UI roles "
        "(background, surface, text, primary, accent). Pass several images to get one "
        "combined moodboard palette. By default the palette size fits the photo; other notable "
        "colors are listed in 'extras' so none are silently dropped. Image paths must be absolute."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "image_paths": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "description": "Absolute path(s) to JPEG/PNG/WebP/TIFF/GIF/BMP images.",
            },
            "count": {"anyOf": [{"type": "integer", "minimum": 1, "maximum": 16},
                                {"type": "string", "enum": ["auto"]}],
                      "default": "auto",
                      "description": "Number of palette colors, or \"auto\" (default) to size the "
                                     "palette to the photo (4-12). Notable colors that don't fit "
                                     "are returned in \"extras\"."},
            "style": {"type": "string", "enum": list(P.STYLES), "default": "clean",
                      "description": "clean (default): de-muddied and balanced; natural: as "
                                     "captured; vivid: punchier; muted: soft and desaturated."},
            "sort": {"type": "string", "enum": list(P.SORTS), "default": "weight",
                     "description": "Order by image coverage, lightness or hue."},
            "include_neutrals": {"type": "boolean", "default": True,
                                 "description": "Allow grays, near-blacks and near-whites."},
            "format": {"type": "string", "enum": list(P.FORMATS), "default": "json",
                       "description": "Text returned to you: json, css, scss, tailwind (v4 "
                                      "@theme), gpl (GIMP/Inkscape/Krita), svg, or text."},
            "prefix": {"type": "string", "default": "palette",
                       "description": "Variable prefix for css/scss/tailwind output."},
            "output_path": {"type": "string",
                            "description": "Optional absolute path to also write the formatted output to."},
            "preview_path": {"type": "string",
                             "description": "Optional absolute .png path for a photo + swatch preview."},
        },
        "required": ["image_paths"],
        "additionalProperties": False,
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True,
                    "openWorldHint": False},
}


def _abs(path: str, what: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ValueError(f"{what} must be an absolute path (got {path!r})")
    return p


def call_extract(args: dict) -> dict:
    paths = args.get("image_paths")
    if isinstance(paths, str):
        paths = [paths]
    if not paths:
        raise ValueError("image_paths is required")
    images = [_abs(p, "image path") for p in paths]
    for p in images:
        if not p.is_file():
            raise ValueError(f"image not found: {p}")

    palette = P.extract_palette(
        images,
        count=args.get("count", "auto"),
        style=args.get("style", "clean"),
        sort=args.get("sort", "weight"),
        neutrals=args.get("include_neutrals", True),
    )
    fmt = args.get("format", "json")
    text = P.render(palette, fmt, prefix=args.get("prefix", "palette"))
    notes = []
    if args.get("output_path"):
        out = _abs(args["output_path"], "output_path")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n", encoding="utf-8")
        notes.append(f"Wrote {fmt} palette to {out}")
    if args.get("preview_path"):
        notes.append(f"Wrote preview to {P.save_preview(palette, _abs(args['preview_path'], 'preview_path'))}")

    content = [{"type": "text", "text": text}]
    if notes:
        content.append({"type": "text", "text": "\n".join(notes)})
    return {"content": content, "structuredContent": palette, "isError": False}


def handle(msg: dict) -> dict | None:
    method, msg_id = msg.get("method"), msg.get("id")
    if msg_id is None:  # notification (e.g. notifications/initialized): no reply
        return None
    params = msg.get("params") or {}

    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
        result = {"protocolVersion": version, "capabilities": {"tools": {"listChanged": False}},
                  "serverInfo": SERVER_INFO,
                  "instructions": "Use extract_palette with absolute image paths to build a "
                                  "color palette from photos."}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [EXTRACT_TOOL]}
    elif method == "tools/call":
        name = params.get("name")
        if name != EXTRACT_TOOL["name"]:
            return _error(msg_id, -32602, f"unknown tool: {name}")
        try:
            result = call_extract(params.get("arguments") or {})
        except (OSError, ValueError, TypeError) as exc:
            result = {"content": [{"type": "text", "text": f"Error: {exc}"}], "isError": True}
    else:
        return _error(msg_id, -32601, f"method not found: {method}")
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _error(msg_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            reply = _error(None, -32700, f"parse error: {exc}")
        else:
            try:
                reply = handle(msg) if isinstance(msg, dict) else _error(None, -32600, "invalid request")
            except Exception as exc:  # never let one bad call kill the server
                traceback.print_exc(file=sys.stderr)
                reply = _error(msg.get("id"), -32603, f"internal error: {exc}")
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
