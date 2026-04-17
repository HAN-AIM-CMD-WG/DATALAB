"""Gedeelde helpers voor document-adapters."""

from __future__ import annotations

from bisect import bisect_right
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from . import AcceptedReplacement, Block


def group_replacements_per_block(
    blocks: list["Block"],
    replacements: list["AcceptedReplacement"],
) -> dict[str, list["AcceptedReplacement"]]:
    """Verdeel flat-tekst-vervangingen over hun bijbehorende blokken.

    Vervangingen worden per blok teruggegeven in *lokale* coördinaten
    (dus ``replacement.start -= block.start``), rechts-naar-links
    gesorteerd zodat het veilig is om ze één voor één in de block-tekst
    toe te passen zonder dat indices verschuiven.

    Vervangingen die een blokgrens oversteken worden overgeslagen; in de
    praktijk zou dat een bug in de hit-coördinaten zijn, maar we maken
    er geen uitzondering van.
    """

    from . import AcceptedReplacement  # local to avoid circular import

    sorted_blocks = sorted(blocks, key=lambda b: b.start)
    block_starts = [b.start for b in sorted_blocks]

    grouped: dict[str, list[AcceptedReplacement]] = {b.id: [] for b in sorted_blocks}
    for rep in replacements:
        idx = bisect_right(block_starts, rep.start) - 1
        if idx < 0:
            continue
        block = sorted_blocks[idx]
        if rep.end > block.end:
            continue
        grouped[block.id].append(
            AcceptedReplacement(
                start=rep.start - block.start,
                end=rep.end - block.start,
                replacement=rep.replacement,
                original=rep.original,
            )
        )

    for block_id in grouped:
        grouped[block_id].sort(key=lambda r: r.start, reverse=True)

    return grouped


def apply_replacements_to_text(
    text: str, replacements: list["AcceptedReplacement"]
) -> str:
    """Pas een lijst lokale vervangingen (rechts-naar-links) toe op een string."""

    out = text
    last_start = len(text) + 1
    for rep in replacements:
        if rep.start < 0 or rep.end > len(out) or rep.end > last_start:
            continue
        out = out[: rep.start] + rep.replacement + out[rep.end :]
        last_start = rep.start
    return out


__all__ = [
    "apply_replacements_to_text",
    "group_replacements_per_block",
]
