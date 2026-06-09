# Unit Tests — SQAT Project

Unit tests written from scratch for the Mealie recipe manager as part of the Software Quality Assurance and Testing project.

## Coverage

| File | Functions Tested |
|------|-----------------|
| `test_auth.py` | `create_access_token` |
| `test_brute_parser.py` | `clean_int`, `clean_string`, `parse_fraction`, `strip_quotes`, `clean_time`, `parse_amount`, `parse_ingredient`, `parse_ingredient_with_comma` |
| `test_cleaner.py` | `clean_instructions`, `clean_yield`, `clean_time` |
| `test_query_filter.py` | `query_filter` builder |
| `test_recipe_service.py` | `can_delete`, `can_merge`, `get_one`, `has_recursive_recipe_link`, `pre_update_check` |
| `test_scheduler.py` | `delete_old_checked` |
| `test_shopping_list.py` | `bulk_create_items`, `merge_items`, `validate`, `can_merge` |

## Testing Criteria Applied

- **ISP** — Input Space Partitioning with Base Choice Coverage
- **Graph Coverage** — Prime Path and DU-Path analysis via CFG
- **Logic Coverage** — RACC, CACC, GACC on compound predicates
- **Parameterized Testing** — `@pytest.mark.parametrize` for data-driven tests
- **Mock Testing** — `MagicMock` and `patch` to isolate service logic from the database
- **Mutation Testing** — mutmut 3.5.0 across 8 source files (overall score: 60%)

## Running the Tests

```bash
pytest tests/our_unit_tests/
```

## Notes

- All tests are grouped into classes ending in `Tests` (e.g. `CanDeleteTests`)
- `setup_method` recreates all mocks before each test to prevent state bleed
- 203 tests total — 100% pass rate
