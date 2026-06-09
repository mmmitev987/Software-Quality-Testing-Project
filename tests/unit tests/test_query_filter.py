"""
Tests for mealie/services/query_filter/builder.py

Functions covered:
- strip_quotes_from_string  : ISP + Logic Coverage (RACC)   (T1_strip_quotes.md)
- validate                  : Logic Coverage (GACC)
                              + Mutation Testing              (T3_validate.md)
"""

import pytest
from uuid import UUID
from datetime import date

from mealie.services.query_filter.builder import (
    QueryFilterBuilderComponent,
    RelationalKeyword,
    RelationalOperator,
)
from sqlalchemy import types as sqltypes
from mealie.db.models._model_utils.guid import GUID


# ===========================================================================
# strip_quotes_from_string — ISP + Logic Coverage (RACC)
# Analysis: T1_strip_quotes.md
# Predicate P = L ∧ F ∧ La
#   L  = len(val) > 2
#   F  = val[0] == '"'
#   La = val[-1] == '"'
# RACC rows: TR1 (all true), TR2 (L active false), TR3 (F active false), TR4 (La active false)
# ===========================================================================

class StripQuotesFromStringTests:

    # ISP C1=A — empty string, returned unchanged
    def test_t1_empty_string(self):
        """TR1 — C1=A: empty string → unchanged"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string("") == ""

    # ISP C1=B — single char, returned unchanged
    def test_t2_single_char(self):
        """TR2 — C1=B: single '"' → unchanged"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('"') == '"'

    # ISP C1=C — len=2, boundary for L clause (L active false) — RACC TR2
    def test_t3_length_two_boundary(self):
        """TR3 — C1=C (RACC TR2): '""' len=2 → L is active false clause, unchanged.
        Kills M1 mutant (>= would strip it)."""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('""') == '""'

    # ISP C1=D, C2=A — len>2, both quotes → stripped — RACC TR1
    def test_t4_base_properly_quoted(self):
        """TR4 — C1=D,C2=A (RACC TR1): all clauses true → stripped"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('"hello"') == "hello"

    # ISP C1=D, C2=B — no closing quote — RACC TR4 (La active false)
    def test_t5_opening_quote_only(self):
        """TR5 — C1=D,C2=B (RACC TR4): '"hello' → La is active false, unchanged"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('"hello') == '"hello'

    # ISP C1=D, C2=C — no opening quote — RACC TR3 (F active false)
    def test_t6_closing_quote_only(self):
        """TR6 — C1=D,C2=C (RACC TR3): 'hello"' → F is active false, unchanged"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('hello"') == 'hello"'

    # ISP C1=D, C2=D — no quotes at all
    def test_t7_no_quotes(self):
        """TR7 — C1=D,C2=D: 'hello' → no quotes, unchanged"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string("hello") == "hello"

    # ISP C1=D, C2=A — minimal valid strip (len=3)
    def test_t8_minimal_valid_strip(self):
        """T8 — C1=D,C2=A minimal: '"x"' len=3 → stripped to 'x'"""
        assert QueryFilterBuilderComponent.strip_quotes_from_string('"x"') == "x"


# ===========================================================================
# validate — Logic Coverage (GACC) + Mutation Testing
# Analysis: T3_validate.md
# P_LIKE = C1 ∨ C2 where C1=LIKE, C2=NOT_LIKE (mutually exclusive → GACC)
# P_BOOL = A ∨ B where A=starts-with-t/y, B=is-"1" (mutually exclusive → GACC)
# ===========================================================================

def _make_comp(value, relationship):
    """Helper: construct QueryFilterBuilderComponent bypassing validation constraints."""
    comp = QueryFilterBuilderComponent.__new__(QueryFilterBuilderComponent)
    comp.value = value
    comp.relationship = relationship
    return comp


class ValidateTests:

    # --- String type (lowercase coercion)

    def test_t1_string_eq_lowercased(self):
        """T1 — C3=String, C2=EQ: value is lowercased.
        Kills M6 mutant (v.upper() would give 'HELLO')."""
        comp = _make_comp("HELLO", RelationalOperator.EQ)
        result = comp.validate(sqltypes.String())
        assert result == "hello"

    # --- P_LIKE GACC

    def test_t2_like_with_string_ok(self):
        """T2 — GACC R2 P_LIKE (C1=LIKE active): LIKE on String col → no error"""
        comp = _make_comp("soup", RelationalKeyword.LIKE)
        result = comp.validate(sqltypes.String())
        assert result == "soup"

    def test_t3_not_like_with_string_ok(self):
        """T3 — GACC R3 P_LIKE (C2=NOT_LIKE active): NOT_LIKE on String → no error"""
        comp = _make_comp("soup", RelationalKeyword.NOT_LIKE)
        result = comp.validate(sqltypes.String())
        assert result == "soup"

    def test_t4_like_on_non_string_raises(self):
        """T4 — GACC R2 P_LIKE + TR7: LIKE on Boolean col → ValueError"""
        comp = _make_comp("true", RelationalKeyword.LIKE)
        with pytest.raises(ValueError, match="LIKE"):
            comp.validate(sqltypes.Boolean())

    # --- GUID validation

    def test_t5_invalid_uuid_raises(self):
        """T5 — C3=GUID: bad UUID string → ValueError"""
        comp = _make_comp("abc-123", RelationalOperator.EQ)
        with pytest.raises(ValueError):
            comp.validate(GUID())

    def test_t6_valid_uuid_passes(self):
        """T6 — C3=GUID: valid UUID string → returned (unchanged, not converted)"""
        uid = "550e8400-e29b-41d4-a716-446655440000"
        comp = _make_comp(uid, RelationalOperator.EQ)
        result = comp.validate(GUID())
        assert result == uid

    # --- Date parsing

    def test_t7_valid_date_parsed(self):
        """T7 — C3=Date: valid date string → date object"""
        comp = _make_comp("2024-01-15", RelationalOperator.EQ)
        result = comp.validate(sqltypes.Date())
        assert result == date(2024, 1, 15)

    def test_t8_invalid_date_raises(self):
        """T8 — C3=Date: unparseable date → ValueError"""
        comp = _make_comp("not-a-date", RelationalOperator.EQ)
        with pytest.raises(ValueError):
            comp.validate(sqltypes.Date())

    # --- Boolean GACC

    def test_t9_bool_true_from_t(self):
        """T9 — GACC R2 P_BOOL (A active): 'true' → True.
        Kills M1 mutant (only checking 't' would miss 'yes')."""
        comp = _make_comp("true", RelationalOperator.EQ)
        assert comp.validate(sqltypes.Boolean()) is True

    def test_t9b_bool_true_from_y(self):
        """T9b — GACC R2 P_BOOL (A active 'y'): 'yes' → True"""
        comp = _make_comp("yes", RelationalOperator.EQ)
        assert comp.validate(sqltypes.Boolean()) is True

    def test_t10_bool_true_from_one(self):
        """T10 — GACC R3 P_BOOL (B active): '1' → True.
        Kills M2 mutant (v == '0' would give False)."""
        comp = _make_comp("1", RelationalOperator.EQ)
        assert comp.validate(sqltypes.Boolean()) is True

    def test_t11_bool_false(self):
        """T11 — GACC R1-base P_BOOL: 'false' → False"""
        comp = _make_comp("false", RelationalOperator.EQ)
        assert comp.validate(sqltypes.Boolean()) is False

    def test_t12_bool_empty_raises(self):
        """T12 — TR8: empty string → IndexError → ValueError"""
        comp = _make_comp("", RelationalOperator.EQ)
        with pytest.raises(ValueError):
            comp.validate(sqltypes.Boolean())

    # --- None value always allowed

    def test_t13_none_value_allowed(self):
        """T13 — TR9: None value is always allowed (skipped), returned unchanged"""
        comp = _make_comp(None, RelationalOperator.EQ)
        result = comp.validate(sqltypes.String())
        assert result is None

    # --- List input → list returned

    def test_t14_list_input_returns_list(self):
        """T14 — TR10: list of strings → all lowercased, list returned"""
        comp = _make_comp(["Hello", "World"], RelationalOperator.EQ)
        result = comp.validate(sqltypes.String())
        assert result == ["hello", "world"]
