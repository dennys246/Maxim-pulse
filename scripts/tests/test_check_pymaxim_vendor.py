"""The vendor check's choice of "the newest pulse tag for a contract"."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from check_pymaxim_vendor import newest_for_contract, stable_version

UPLOADED = 1_000.0


def test_stable_version_rejects_pre_releases_and_strays() -> None:
    assert stable_version("v0.4.1") == (0, 4, 1)
    assert stable_version("v0.10.0") == (0, 10, 0)
    for tag in ("v0.5.0-rc.1", "v0.5.0rc1", "v0.5", "0.5.0", "v0.5.0.1", "vnext"):
        assert stable_version(tag) is None, tag


def test_a_pre_release_is_never_the_tag_a_release_should_vendor() -> None:
    tags = [("v0.4.1", 100.0, "0.6.0"), ("v0.5.0-rc.1", 200.0, "0.6.0")]
    assert newest_for_contract(tags, UPLOADED, "0.6.0") == "v0.4.1"


def test_newest_is_semver_order_not_tag_order() -> None:
    # A hotfix for an older line, tagged AFTER the newer release.
    tags = [("v0.5.0", 100.0, "0.6.0"), ("v0.4.2", 200.0, "0.6.0")]
    assert newest_for_contract(tags, UPLOADED, "0.6.0") == "v0.5.0"
    # Numeric, not lexical: v0.10.0 > v0.9.0.
    tags = [("v0.10.0", 100.0, "0.6.0"), ("v0.9.0", 200.0, "0.6.0")]
    assert newest_for_contract(tags, UPLOADED, "0.6.0") == "v0.10.0"


def test_only_tags_that_existed_at_upload_and_match_the_contract() -> None:
    tags = [
        ("v0.4.1", 100.0, "0.6.0"),
        ("v0.4.2", 2_000.0, "0.6.0"),  # tagged after the wheel was uploaded
        ("v0.5.0", 200.0, "0.7.0"),  # another contract
    ]
    assert newest_for_contract(tags, UPLOADED, "0.6.0") == "v0.4.1"
    assert newest_for_contract(tags, UPLOADED, "0.8.0") is None
