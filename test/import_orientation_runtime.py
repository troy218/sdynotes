"""PDF/Word 방향 판별을 외부 변환 패키지 없이 실행하는 집중 계약."""
import ast
import io
import sys
import types
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / "worker/sdynotes_worker/importer.py").read_text(encoding="utf-8")
tree = ast.parse(source)
functions = {"_preset_dims", "_pdf_size_preset", "_docx_size_preset"}
nodes = []
for node in tree.body:
    if isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "PAGE_PRESETS"
        for target in node.targets
    ):
        nodes.append(node)
    elif isinstance(node, ast.FunctionDef) and node.name in functions:
        nodes.append(node)


class Rect:
    def __init__(self, width, height):
        self.width = width
        self.height = height


class PdfPage:
    def __init__(self, width, height):
        self.rect = Rect(width, height)


class PdfDoc:
    def __init__(self, sizes):
        self.pages = [PdfPage(*size) for size in sizes]
        self.page_count = len(self.pages)
        self.closed = False

    def __getitem__(self, index):
        return self.pages[index]

    def close(self):
        self.closed = True


pdf_cases = {
    "portrait.pdf": [(600, 900), (600, 900)],
    "landscape.pdf": [(900, 600), (900, 600)],
    "mixed.pdf": [(900, 600), (600, 900), (900, 600)],
}
opened = []


def open_pdf(name):
    doc = PdfDoc(pdf_cases[name])
    opened.append(doc)
    return doc


namespace = {
    "io": io,
    "pymupdf": types.SimpleNamespace(open=open_pdf),
    "IMPORT_MAX_PAGES": 1200,
}
exec(compile(ast.Module(nodes, type_ignores=[]), "importer-orientation", "exec"), namespace)

assert namespace["_preset_dims"]("a4_portrait") == (800, 1100)
assert namespace["_preset_dims"]("a4_landscape") == (1100, 800)
assert namespace["_pdf_size_preset"]("portrait.pdf") == "a4_portrait"
assert namespace["_pdf_size_preset"]("landscape.pdf") == "a4_landscape"
assert namespace["_pdf_size_preset"]("mixed.pdf") == "a4_landscape"
assert all(doc.closed for doc in opened)

# _docx_size_preset 안의 지연 import를 가짜 python-docx 모듈로 실행한다.
LANDSCAPE = object()
word_cases = []


class Section:
    def __init__(self, width, height, orientation=None):
        self.page_width = width
        self.page_height = height
        self.orientation = orientation


class WordDoc:
    def __init__(self, sections):
        self.sections = sections


def open_word(_stream):
    return WordDoc(word_cases)


docx_module = types.ModuleType("docx")
docx_module.Document = open_word
docx_enum = types.ModuleType("docx.enum")
docx_section = types.ModuleType("docx.enum.section")
docx_section.WD_ORIENT = types.SimpleNamespace(LANDSCAPE=LANDSCAPE)
sys.modules["docx"] = docx_module
sys.modules["docx.enum"] = docx_enum
sys.modules["docx.enum.section"] = docx_section

word_cases[:] = [Section(800, 1100), Section(800, 1100)]
assert namespace["_docx_size_preset"](b"portrait") == "a4_portrait"
word_cases[:] = [Section(1100, 800)]
assert namespace["_docx_size_preset"](b"landscape") == "a4_landscape"
# orientation 플래그만 가로인 Word 구역도 놓치지 않는다.
word_cases[:] = [Section(800, 1100, LANDSCAPE)]
assert namespace["_docx_size_preset"](b"flagged") == "a4_landscape"

print("문서 방향 런타임 계약: PASS 9/9")
