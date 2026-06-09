"""
Tests for mealie/services/parser_services/brute/process.py

Functions covered:
- parse_fraction            : ISP                              (T1_parse_fraction.md)
- parse_amount              : Graph Coverage — Prime Paths
                              + DU-Path                        (T2_parse_amount.md)
- parse_ingredient          : Graph Coverage — Edge-Pair       (T2_parse_ingredient.md)
- parse_ingredient_with_comma: Graph Coverage — Edge-Pair + ISP (T2_parse_ingredient_with_comma.md)
"""

import pytest

from mealie.services.parser_services.brute.process import (
    parse_fraction,
    parse_amount,
    parse_ingredient,
    parse_ingredient_with_comma,
)


# ===========================================================================
# parse_fraction — ISP
# Analysis: T1_parse_fraction.md
# Characteristic C1: input structure (6 partitions)
# ===========================================================================

class ParseFractionTests:

    # C1=A — single Unicode fraction character
    @pytest.mark.parametrize("char, expected", [
        pytest.param("½", 0.5, id="T1-unicode-half"),
        pytest.param("⅓", pytest.approx(1 / 3), id="T2-unicode-third"),
        pytest.param("¾", 0.75, id="T3-unicode-three-quarters"),
    ])
    def test_unicode_fraction(self, char, expected):
        """TR1 — C1=A: Unicode fraction chars correctly decomposed to float."""
        assert parse_fraction(char) == expected

    # C1=B — valid "N/D" string
    @pytest.mark.parametrize("text, expected", [
        pytest.param("1/2", 0.5, id="T4-slash-half"),
        pytest.param("3/4", 0.75, id="T5-slash-three-quarters"),
    ])
    def test_slash_fraction(self, text, expected):
        """TR2 — C1=B: valid 'N/D' strings return correct float."""
        assert parse_fraction(text) == expected

    def test_zero_denominator_raises(self):
        """T6 — C1=C: zero denominator → ValueError (ZeroDivisionError caught)."""
        with pytest.raises(ValueError):
            parse_fraction("1/0")

    @pytest.mark.parametrize("text", [
        pytest.param("abc", id="T7-no-slash-long"),
        pytest.param("", id="T8-empty-str"),
    ])
    def test_no_slash_raises(self, text):
        """TR4 — C1=D: no slash in string → ValueError."""
        with pytest.raises(ValueError):
            parse_fraction(text)

    def test_multiple_slashes_raises(self):
        """T9 — C1=E: multiple slashes → ValueError."""
        with pytest.raises(ValueError):
            parse_fraction("1/2/3")

    def test_single_non_fraction_char_raises(self):
        """T10 — C1=F: single non-fraction char → ValueError (distinct path from C1=D)."""
        with pytest.raises(ValueError):
            parse_fraction("a")


# ===========================================================================
# parse_amount — Graph Coverage (Prime Paths + DU-Path)
# Analysis: T2_parse_amount.md
# Returns (amount, unit, note)
# ===========================================================================

class ParseAmountTests:

    # PP1 — Unicode fraction, no remaining string
    def test_pp1_unicode_no_remaining(self):
        """T1 — PP1: unicode fraction '½', nothing after → (0.5, '', '')"""
        assert parse_amount("½") == (0.5, "", "")

    # PP3 — Unicode fraction, remaining string → unit
    def test_pp3_unicode_with_unit(self):
        """T2 — PP3: '½cups' → did_check_frac=True → unit from remainder"""
        assert parse_amount("½cups") == (0.5, "cups", "")

    # PP4 — Unicode fraction, remaining starts with '(' → note
    def test_pp4_unicode_weird_unit(self):
        """T3 — PP4: '½(500ml)' → unit starts with '(' → cleared, note=whole string"""
        assert parse_amount("½(500ml)") == (0.5, "", "½(500ml)")

    # PP2 — Unicode fraction, remaining starts with '-' → note
    def test_pp2_unicode_dash_unit(self):
        """T12 — PP2: '½-2' → unit starts with '-' → cleared, note=whole string"""
        assert parse_amount("½-2") == (0.5, "", "½-2")

    # PP5 — Fraction string "1/2", no remaining
    def test_pp5_fraction_str_no_remaining(self):
        """T4 — PP5: '1/2' → fraction parsed, no remaining"""
        assert parse_amount("1/2") == (0.5, "", "")

    # PP7 — Fraction string "1/2cups", next char not a fraction → unit
    def test_pp7_fraction_str_with_unit(self):
        """T5 — PP7: '1/2cups' → ValueError path at node 14 → unit='cups'"""
        assert parse_amount("1/2cups") == (0.5, "cups", "")

    # PP8 — Integer, no remaining
    def test_pp8_integer_no_remaining(self):
        """T6 — PP8: '42' → integer parsed, no remaining"""
        assert parse_amount("42") == (42.0, "", "")

    # PP10 — Integer + unicode fraction (mixed number) → DU D-decimal→U-aug
    def test_pp10_mixed_number_integer_unicode(self):
        """T7 — PP10/DU: '2½cups' → amount=2.0 + 0.5 = 2.5, unit='cups'"""
        assert parse_amount("2½cups") == (2.5, "cups", "")

    # PP11 — Integer, next char NOT fraction → ValueError path → unit
    def test_pp11_integer_with_unit(self):
        """T8 — PP11: '2cups' → integer 2.0, unit='cups'"""
        assert parse_amount("2cups") == (2.0, "cups", "")

    # PP12 — Integer, remaining starts with '-' → note
    def test_pp12_integer_dash_note(self):
        """T9 — PP12: '2-3' → unit starts with '-' → cleared, note=whole str"""
        assert parse_amount("2-3") == (2.0, "", "2-3")

    # PP9 — Integer, remaining starts with '(' → note
    def test_pp9_integer_paren_note(self):
        """T10 — PP9: '2(500ml)' → unit starts with '(' → cleared, note"""
        assert parse_amount("2(500ml)") == (2.0, "", "2(500ml)")

    # DU: D-decimal → U-aug (mixed number with tbsp)
    def test_du_decimal_augmented(self):
        """T11 — DU D-decimal→U-aug: '2½tbsp' → 2.0 + 0.5 = 2.5, unit='tbsp'"""
        assert parse_amount("2½tbsp") == (2.5, "tbsp", "")


# ===========================================================================
# parse_ingredient — Graph Coverage (Edge-Pair Coverage)
# Analysis: T2_parse_ingredient.md
# 5 execution paths cover all 14 edge pairs
# Dead code: 'start < 0' branch is unreachable — documented but not tested
# ===========================================================================

class ParseIngredientTests:

    def test_path_a_no_closing_bracket(self):
        """TC1 — Path A (EP1,EP2): no closing ')' → delegate to parse_ingredient_with_comma"""
        result = parse_ingredient(["red", "pepper", "flakes"])
        assert result == ("red pepper flakes", "")

    def test_path_b_bracket_embedded_in_last_token(self):
        """TC2 — Path B (EP3,EP4): '(' inside last token → early return via delegate"""
        result = parse_ingredient(["mango", "chunks(4)"])
        assert result == ("mango chunks(4)", "")

    def test_path_c_opening_bracket_found_immediately(self):
        """TC3 — Path C (EP5,EP6,EP7,EP12,EP13,EP14): loop skipped, bracket in last pos"""
        result = parse_ingredient(["water", "(cold)"])
        assert result == ("water", "cold")

    def test_path_d_opening_bracket_after_multiple_iterations(self):
        """TC4 — Path D (EP8,EP9,EP10): while loop runs 2+ times before finding '('"""
        result = parse_ingredient(["apple", "(sauce", "with", "honey)"])
        assert result == ("apple", "sauce with honey")

    def test_path_e_scan_reaches_index_zero_raises(self):
        """TC5 — Path E (EP11): scan reaches start==0 → ValueError"""
        with pytest.raises(ValueError):
            parse_ingredient(["(apple", "sauce", "honey)"])


# ===========================================================================
# parse_ingredient_with_comma — Graph Coverage (Edge-Pair) + ISP
# Analysis: T2_parse_ingredient_with_comma.md
# 9 edge pairs; 3 tests achieve full edge-pair coverage + 2 ISP boundary tests
# ===========================================================================

class ParseIngredientWithCommaTests:

    def test_ep1_ep2_ep3_ep4_ep6_ep8_no_comma(self):
        """T1 — EP1,EP2,EP3,EP4,EP6,EP8: C1=A no comma → all tokens become ingredient"""
        result = parse_ingredient_with_comma(["red", "pepper"])
        assert result == ("red pepper", "")

    def test_ep1_ep2_ep4_ep7_ep9_comma_in_middle(self):
        """T2 — EP1,EP2,EP4,EP7,EP9: C1=C comma in middle → splits ingredient/note"""
        result = parse_ingredient_with_comma(["1", "cup,", "flour", "sifted"])
        assert result == ("1 cup", "flour sifted")

    def test_ep5_ep7_ep9_comma_in_first_token(self):
        """T3 — EP5,EP7,EP9: C1=B comma in first token → loop body never executes"""
        result = parse_ingredient_with_comma(["onion,", "finely", "chopped"])
        assert result == ("onion", "finely chopped")

    def test_isp_c1b_c2b_no_note_after_comma(self):
        """T4 — C1=B, C2=B: first token has comma, no tokens after → note=''"""
        result = parse_ingredient_with_comma(["sugar,"])
        assert result == ("sugar", "")

    def test_isp_c1d_comma_in_last_token(self):
        """T5 — C1=D: comma in last token → note is empty"""
        result = parse_ingredient_with_comma(["1", "cup,"])
        assert result == ("1 cup", "")
