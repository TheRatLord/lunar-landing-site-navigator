"""Clause and section labels: "(2.3)", "clause 4.1" are names of a place in a document, not numbers an answer states.

The answer guard looks for every number of an answer in a record of the run. A planner's constraint document numbers its
clauses (``2.3 No single period of array darkness shall exceed 1,800 minutes``) and a correct answer names the clause it
checked (``Dark span (2.3): PASS``). Cited to the record that holds the value, the label is "a number the record does not
state"; no citation can satisfy that. So a token is accepted as a label, and only then, when both hold:

* **It is a label in a document of this run.** It appears verbatim as the label of a sentence of an ingested document (a
  sentence or a heading that starts with it: ``2.3 No single ...``, ``## 4. Communications``) or after ``clause``,
  ``section``, ``§``, ``item`` ... in such a document or in the user's own words. A token that no document of the run labels,
  such as a value written as ``(2.3)``, is an ordinary number and is checked as before.
* **The sentence uses it as a label.** Every occurrence of the token in the line is parenthesised (``Slope (5.1):``) or follows
  ``clause``, ``section``, ``§``, ``item`` ... (``clause 2.3``, ``clauses 2.2 and 2.3``), and it has no unit. One occurrence
  elsewhere in the line (``a margin of 2.3``) makes the token a number again, for all its occurrences.

A bare sentence start (``240 hours of ...``) and a decimal below one (``0.14 rad ...``) are not labels, so a value a document
states at the start of a sentence cannot become one. Residual: a document label placed in parentheses where a value belongs
(``margin (2.3) is fine`` with a clause 2.3 in the document) is read as the label; it is a place name that exists in the
document, never a number the engine did not compute.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any

_TOKEN = r"\d{1,3}(?:\.\d{1,3}){0,3}"
_WORD = r"(?:clauses?|sections?|items?|requirements?|paragraphs?|articles?|para\.?|sec\.?|cl\.?|§)"
_LISTED = re.compile(rf"{_WORD}\s*\(?({_TOKEN})\)?((?:\s*(?:,|and|or|&|to)\s*\(?{_TOKEN}\)?)*)", re.IGNORECASE)
_USE_WORD = rf"(?:{_WORD}|see|cf\.?|in|under|per)"
_USED = re.compile(rf"\b{_USE_WORD}\s*\(?({_TOKEN})\)?((?:\s*(?:,|and|or|&|to)\s*\(?{_TOKEN}\)?)*)", re.IGNORECASE)
_TOKENS = re.compile(_TOKEN)
_START = re.compile(rf"^\s*(?:#+\s*)?(?:[-*]\s+)?(?:§\s*)?({_TOKEN})(\.?)(?=\s+[A-Z(\"']|\s*$)")
_PAREN = re.compile(rf"\(\s*({_TOKEN})\s*\)")


def _is_label_shape(token: str, trailing_dot: str) -> bool:
    """A sentence-start number is a label when it is dotted (``2.3``), ends in a dot (``4.``), and is not a decimal below one."""
    if token.split(".")[0] == "0":
        return False
    return "." in token or bool(trailing_dot)


def labels_in_text(text: str) -> set[str]:
    """Clause labels a document sentence or a user message names: its own leading label and any after ``clause``, ``§`` ..."""
    found: set[str] = set()
    m = _START.match(text)
    if m and _is_label_shape(m.group(1), m.group(2)):
        found.add(m.group(1))
    for m in _LISTED.finditer(text):
        found.add(m.group(1))
        found.update(_TOKENS.findall(m.group(2)))
    return found


def document_labels(*bodies: Any) -> set[str]:
    """Labels of every ``text`` string found in a document result (its sentences, mentions and the stored full list)."""
    found: set[str] = set()
    for text in _texts(bodies):
        found |= labels_in_text(text)
    return found


def _texts(obj: Any) -> Iterator[str]:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "text" and isinstance(value, str):
                yield value
            else:
                yield from _texts(value)
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            yield from _texts(item)


def label_use_spans(line: str) -> set[int]:
    """Start offsets of the tokens of ``line`` that are written as labels (parenthesised, or after ``clause``, ``§``, ``in`` ...)."""
    starts = {m.start(1) for m in _PAREN.finditer(line)}
    for m in _USED.finditer(line):
        starts.add(m.start(1))
        starts.update(m.start(2) + t.start() for t in _TOKENS.finditer(m.group(2)))
    return starts


def is_label_use(token: str, line: str, labels: set[str] | frozenset[str]) -> bool:
    """Whether ``token`` is a clause label of a document of the run and every occurrence of it in ``line`` is written as one."""
    if token not in labels:
        return False
    used = label_use_spans(line)
    spots = [m.start() for m in re.finditer(rf"(?<![\w.]){re.escape(token)}(?![\w]|\.\d)", line)]
    return bool(spots) and all(s in used for s in spots)
