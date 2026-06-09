"""
Tests for mealie/services/scraper/cleaner.py

Functions covered:
- clean_string  : ISP + Parameterized Testing        (T1_clean_string.md)
- clean_int     : ISP + Mutation Testing             (T1_clean_int.md)
- parse_duration: ISP                                (T2_clean_time.md)
- clean_instructions: Graph Coverage — Prime Paths   (T2_clean_instructions.md)
- clean_yield   : ISP + Logic Coverage (RACC)        (T3_clean_yield.md)
- clean_time    : Graph Coverage — Prime Paths       (T2_clean_time.md)
"""

import pytest
from datetime import timedelta, datetime
from unittest.mock import MagicMock

from mealie.services.scraper.cleaner import (
    clean_string,
    clean_int,
    clean_instructions,
    clean_yield,
    clean_time,
    parse_duration,
)


# ---------------------------------------------------------------------------
# Fixture: translator mock (used by clean_time)
# translator.t(key, count=n) → key  (identity translation)
# pretty_print_timedelta formats as  f"{n_txt} {scale_value}" = f"{n_txt} {key}"
# ---------------------------------------------------------------------------

@pytest.fixture
def translator():
    t = MagicMock()
    t.t.side_effect = lambda key, **kw: key
    return t


# ===========================================================================
# clean_string — ISP + Parameterized Testing
# Analysis: T1_clean_string.md
# Characteristics: C1 (input type), C2 (string content)
# Base choice: C1=A (str), C2=B (plain text)
# ===========================================================================

@pytest.mark.parametrize("text, expected", [
    # --- C1=A (str), C2=B — plain text passes through (base case)
    pytest.param("hello world", "hello world", id="T1-base-plain-str"),
    # --- C1=A, C2=A — empty string fast-path (node 10→11)
    pytest.param("", "", id="T7-empty-str"),
    # --- C1=A, C2=C — HTML tags stripped
    pytest.param("<p>hello</p>", "hello", id="T8-html-stripped"),
    # --- C1=A, C2=D — HTML entity unescaped
    pytest.param("&amp;hello", "&hello", id="T9-html-entity"),
    # --- C1=A, C2=E — multiple spaces collapsed
    pytest.param("hello   world", "hello world", id="T10-multi-space"),
    # --- C1=A, C2=F — NBSP replaced with space
    pytest.param("hello\xa0world", "hello world", id="T11-nbsp"),
    # --- C1=A, C2=F — tab replaced with space
    pytest.param("hello\tworld", "hello world", id="T12-tab"),
    # --- C1=B, C2=B — non-empty list, recursive on first element
    pytest.param(["hello world"], "hello world", id="T2-list-nonempty"),
    # --- C1=C — empty list → ""
    pytest.param([], "", id="T3-list-empty"),
    # --- C1=D — None → ""
    pytest.param(None, "", id="T4-none"),
    # --- C1=E — int → str conversion
    pytest.param(42, "42", id="T5-int"),
    # --- C1=E — float → str conversion
    pytest.param(3.14, "3.14", id="T6-float"),
    # --- C1=B, C2=C — list + HTML combined
    pytest.param(["<b>bold</b>"], "bold", id="T13-list-html"),
], ids=lambda x: None if not isinstance(x, str) else x)
def test_clean_string(text, expected):
    assert clean_string(text) == expected


# ===========================================================================
# clean_int — ISP + Mutation Testing
# Analysis: T1_clean_int.md
# Characteristics: C1 (val type), C2 (bounds), C3 (range position)
# Mutation targets: <= vs < at boundary in node 10
# ===========================================================================

@pytest.mark.parametrize("val, min_, max_, expected", [
    # --- C1=A: None passes through unchanged
    pytest.param(None, None, None, None, id="T1-none"),
    # --- C1=B: int passes through unchanged (including 0)
    pytest.param(5, None, None, 5, id="T2-int"),
    pytest.param(0, None, None, 0, id="T3-falsy-int"),
    # --- C1=C, C2=A: digits-only string → parsed int (base case)
    pytest.param("42", None, None, 42, id="T4-base-str-digits"),
    # --- C1=D, C2=A: mixed string → digits extracted
    pytest.param("abc5def", None, None, 5, id="T5-mixed-str"),
    # --- C1=E, C2=A: no-digits string → None
    pytest.param("abc", None, None, None, id="T6-no-digits"),
    # --- C1=C, C2=B, C3=C: in-range interior
    pytest.param("5", 1, 10, 5, id="T7-in-range"),
    # --- C1=C, C2=B, C3=A: val == min (lower boundary) — kills M1 mutant
    pytest.param("1", 1, 10, 1, id="T8-at-min"),
    # --- C1=C, C2=B, C3=B: val == max (upper boundary) — kills M2 mutant
    pytest.param("10", 1, 10, 10, id="T9-at-max"),
    # --- C1=C, C2=B, C3=D: below min → None
    pytest.param("0", 1, 10, None, id="T10-below-min"),
    # --- C1=C, C2=B, C3=E: above max → None
    pytest.param("15", 1, 10, None, id="T11-above-max"),
    # --- C1=C, C2=C: only min given → no bounds check — kills M4 mutant
    pytest.param("5", 1, None, 5, id="T12-only-min"),
    # --- C1=C, C2=D: only max given → no bounds check — kills M4 mutant
    pytest.param("5", None, 10, 5, id="T13-only-max"),
])
def test_clean_int(val, min_, max_, expected):
    assert clean_int(val, min=min_, max=max_) == expected


# ===========================================================================
# parse_duration — ISP
# Analysis: T2_clean_time.md (§5 ISP Analysis for parse_duration)
# Characteristics: C1 (string format), C2 (components present)
# Note: regex REQUIRES the 'T' separator
# ===========================================================================

def test_parse_duration_no_match_raises():
    """T13 — C1=A: non-ISO string → ValueError"""
    with pytest.raises(ValueError):
        parse_duration("1 hour 30 minutes")


def test_parse_duration_no_t_separator_raises():
    """T14 — C1=A: 'P1D' without T separator → ValueError (regex requires T)"""
    with pytest.raises(ValueError):
        parse_duration("P1D")


@pytest.mark.parametrize("iso_str, expected", [
    # --- C1=B, C2=A: hours only
    pytest.param("PT1H", timedelta(hours=1), id="T15-hours-only"),
    # --- C1=B, C2=B: minutes only
    pytest.param("PT30M", timedelta(minutes=30), id="T16-minutes-only"),
    # --- C1=B, C2=C: seconds only
    pytest.param("PT45S", timedelta(seconds=45), id="T17-seconds-only"),
    # --- C1=C, C2=D: days only (with T separator required)
    pytest.param("P2DT", timedelta(days=2), id="T18-days-only"),
    # --- C1=D, C2=E: combined hours + minutes + seconds
    pytest.param("PT1H30M15S", timedelta(hours=1, minutes=30, seconds=15), id="T19-combined"),
    # --- C1=E: years/months present (parsed but contribute 0 days)
    pytest.param("P1Y2MT1H", timedelta(hours=1), id="T20-years-months-ignored"),
])
def test_parse_duration(iso_str, expected):
    assert parse_duration(iso_str) == expected


# ===========================================================================
# clean_instructions — Graph Coverage (Prime Paths)
# Analysis: T2_clean_instructions.md
# 10 prime paths → 12 test cases
# ===========================================================================

@pytest.mark.parametrize("steps_object, expected", [
    # PP1 — empty list (falsy) → []
    pytest.param([], [], id="T1-PP1-empty-list"),
    # PP1 — None (falsy) → []
    pytest.param(None, [], id="T2-PP1-none"),
    # PP2 — Arm 1: single {"text": str} — returned UNCHANGED (no sanitisation)
    pytest.param(
        [{"text": "Mix flour"}],
        [{"text": "Mix flour"}],
        id="T3-PP2-arm1-single-dict-unchanged",
    ),
    # PP3 — Arm 2: multi {"text": str} list — sanitised
    pytest.param(
        [{"text": "Step 1"}, {"text": "Step 2"}],
        [{"text": "Step 1"}, {"text": "Step 2"}],
        id="T4-PP3-arm2-multi-dict",
    ),
    # PP3 — Arm 2: HTML inside {"text"} is sanitised
    pytest.param(
        [{"text": "<b>Bold step</b>"}, {"text": "Step 2"}],
        [{"text": "Bold step"}, {"text": "Step 2"}],
        id="T5-PP3-arm2-html-stripped",
    ),
    # PP4 — Arm 3: dict with string integer keys → converted to list
    pytest.param(
        {"0": {"text": "Step A"}, "1": {"text": "Step B"}},
        [{"text": "Step A"}, {"text": "Step B"}],
        id="T6-PP4-arm3-dict-keyed",
    ),
    # PP5 — Arm 4: JSON string starting with '[', valid JSON → recursive
    pytest.param(
        '[{"text": "Step X"}]',
        [{"text": "Step X"}],
        id="T7-PP5-arm4-json-str-valid",
    ),
    # PP6 — Arm 4: JSON-like string, invalid JSON → splitlines
    pytest.param(
        "[not valid json",
        [{"text": "[not valid json"}],
        id="T8-PP6-arm4-json-str-invalid",
    ),
    # PP7 — Arm 4: plain multiline string → splitlines
    pytest.param(
        "Step 1\nStep 2\nStep 3",
        [{"text": "Step 1"}, {"text": "Step 2"}, {"text": "Step 3"}],
        id="T9-PP7-arm4-plain-str-splitlines",
    ),
    # PP8 — Arm 5: list of plain strings → sanitised
    pytest.param(
        ["Step 1", "Step 2"],
        [{"text": "Step 1"}, {"text": "Step 2"}],
        id="T10-PP8-arm5-list-of-strings",
    ),
    # PP9 — Arm 6: HowToSection → flatten + recursive
    pytest.param(
        [{"@type": "HowToSection", "itemListElement": [{"text": "Step A"}]}],
        [{"text": "Step A"}],
        id="T11-PP9-arm6-howtosection",
    ),
])
def test_clean_instructions(steps_object, expected):
    assert clean_instructions(steps_object) == expected


def test_clean_instructions_pp10_type_error():
    """T12 — PP10: unsupported type (int) → TypeError (default arm)"""
    with pytest.raises(TypeError):
        clean_instructions(42)


# ===========================================================================
# clean_yield — ISP + Logic Coverage (RACC)
# Analysis: T3_clean_yield.md
# Predicate P = A ∧ B where A=qty truthy, B=_is_serving_string(yld)
# RACC rows: TR1 (P=T), TR2 (A active false), TR3 (B active false)
# ===========================================================================

@pytest.mark.parametrize("yields, expected", [
    # ISP C1=A — None (falsy) → all zeros, predicate never reached (T1)
    pytest.param(None, (0, 0, ""), id="T1-none"),
    # ISP C1=B — empty string (falsy) → all zeros (T2)
    pytest.param("", (0, 0, ""), id="T2-empty-str"),
    # ISP C1=C, RACC TR1 — P=True: qty>0 AND is_serving → servings_qty (T3)
    pytest.param("4 servings", (4.0, 0, ""), id="T3-RACC-TR1-serving-string"),
    # ISP C1=D, RACC TR3 — B active false: qty>0 AND not serving → yld branch (T4)
    pytest.param("4 pies", (0, 4.0, "pies"), id="T4-RACC-TR3-B-active-false"),
    # ISP C1=C, RACC TR2 — A active false: qty=0 AND is_serving → yld branch (T5)
    pytest.param("servings", (0, 0, "servings"), id="T5-RACC-TR2-A-active-false"),
    # ISP C1=E — list with serving element (T6)
    pytest.param(["6 servings"], (6.0, 0, ""), id="T6-list-serving"),
    # ISP C1=F — list mixing serving + non-serving: both P=T and P=F branches (T7)
    pytest.param(["4 servings", "4 pies"], (4.0, 4.0, "pies"), id="T7-list-mixed"),
    # ISP: falsy element inside list skipped via continue (T8)
    pytest.param(["4 servings", ""], (4.0, 0, ""), id="T8-list-with-empty"),
])
def test_clean_yield(yields, expected):
    assert clean_yield(yields) == expected


# ===========================================================================
# clean_time — Graph Coverage (Prime Paths)
# Analysis: T2_clean_time.md
# translator.t side_effect: lambda key, **kw: key
# pretty_print_timedelta formats as f"{n_txt} {scale_value}" = f"{n_txt} {key}"
# ===========================================================================

class CleanTimeTests:
    """10 prime paths (PP1–PP10) mapped to 12 test cases."""

    def test_pp1_none_returns_none(self, translator):
        """PP1 — falsy input (None)"""
        assert clean_time(None, translator) is None

    def test_pp1_zero_returns_none(self, translator):
        """PP1 — falsy input (0)"""
        assert clean_time(0, translator) is None

    def test_pp2_int_minutes(self, translator):
        """PP2 — integer → timedelta(minutes=n) → pretty-printed"""
        result = clean_time(30, translator)
        assert result == "30 datetime.minute"

    def test_pp2_float_minutes(self, translator):
        """PP2 — float → timedelta(minutes=1.5) = 1 min 30 sec"""
        result = clean_time(1.5, translator)
        assert result == "1 datetime.minute 30 datetime.second"

    def test_pp3_blank_string_returns_none(self, translator):
        """PP3 — blank/whitespace string → None"""
        assert clean_time("   ", translator) is None

    def test_pp4_valid_iso_string(self, translator):
        """PP4 — valid ISO 8601 → parse_duration → pretty-printed"""
        result = clean_time("PT1H", translator)
        assert result == "1 datetime.hour"

    def test_pp4_valid_iso_combined(self, translator):
        """PP4 — combined ISO: PT1H30M → pretty-printed"""
        result = clean_time("PT1H30M", translator)
        assert "datetime.hour" in result
        assert "datetime.minute" in result

    def test_pp5_invalid_iso_returned_raw(self, translator):
        """PP5 — invalid ISO string → returned as-is"""
        result = clean_time("1 hour 30 mins", translator)
        assert result == "1 hour 30 mins"

    def test_pp6_timedelta_input(self, translator):
        """PP6 — timedelta object → pretty-printed directly"""
        result = clean_time(timedelta(hours=2), translator)
        assert result == "2 datetime.hour"

    def test_pp7_dict_min_value(self, translator):
        """PP7 — {'minValue': 'PT30M'} → recursive call"""
        result = clean_time({"minValue": "PT30M"}, translator)
        assert result == "30 datetime.minute"

    def test_pp8_list_first_element(self, translator):
        """PP8 — list starting with str → recursive on first element"""
        result = clean_time(["PT1H"], translator)
        assert result == "1 datetime.hour"

    def test_pp9_datetime_returns_str(self, translator):
        """PP9 — datetime object → str()"""
        result = clean_time(datetime(2024, 1, 1), translator)
        assert result == "2024-01-01 00:00:00"

    def test_pp10_unsupported_type_returns_none(self, translator):
        """PP10 — bytes (unsupported) → log warning, return None"""
        assert clean_time(b"bytes", translator) is None
