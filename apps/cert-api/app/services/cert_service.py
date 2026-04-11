"""Certification comparison and validation logic."""

import difflib
import re
from datetime import UTC, datetime
from html import unescape

import requests

from app.config import CERT_KEYWORDS, CERT_SPEC_NAMES, VTEX_STORES
from app.utils.logging import log

# ---------------------------------------------------------------------------
# HTML / text utilities
# ---------------------------------------------------------------------------


def strip_html(html_text: str, keep_newlines: bool = False) -> str:
    """Remove HTML tags from a string.

    Args:
        html_text: Raw HTML string to clean.
        keep_newlines: When True, block-level tags become newlines instead of spaces.

    Returns:
        Plain text string.
    """
    if not html_text:
        return ""
    if keep_newlines:
        text = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", html_text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = unescape(text)
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
        return "\n".join(line for line in lines if line)
    text = re.sub(r"<[^>]+>", " ", html_text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def extract_cert_sentences(text: str) -> list[str]:
    """Extract only fragments that contain certification keywords.

    Args:
        text: Plain text to scan.

    Returns:
        List of fragments that mention certification keywords.
    """
    if not text:
        return []
    fragments = re.split(r"[\n;|]+|(?<=\.)\s+", text)
    results = []
    for frag in fragments:
        frag = frag.strip().rstrip(".")
        if not frag or len(frag) < 5:
            continue
        frag_lower = frag.lower()
        if any(kw in frag_lower for kw in CERT_KEYWORDS):
            results.append(frag.strip())
    return results


def extract_cert_bodies(text: str) -> set[str]:
    """Identify which certification bodies are mentioned in text.

    Args:
        text: Text to scan for certification body names.

    Returns:
        Set of body names found (e.g. {'inmetro', 'anvisa'}).
    """
    bodies: set[str] = set()
    lower = text.lower()
    for body in ("inmetro", "anvisa", "anatel", "abnt"):
        if body in lower:
            bodies.add(body)
    # OCP / BRICS are INMETRO-accredited certification bodies
    if "inmetro" not in bodies and ("ocp " in lower or "brics" in lower):
        bodies.add("inmetro")
    return bodies


def has_registration_number(text: str) -> bool:
    """Check if text contains a registration/certificate number pattern.

    Args:
        text: Text to scan.

    Returns:
        True if at least one registration pattern is found.
    """
    patterns = [
        r"\d{4,}/\d{4}",
        r"n[°ºo]\s*\.?\s*\d{3,}",
        r"registro\s+\d{3,}",
        r"ocp\s+\d{3,}",
        r"certificado\s+(?:n[°ºo]?\s*)?\.?\s*\d{3,}",
        r"homologa[çc][ãa]o[^:]*:\s*\d{3,}",
        r"\d{4,}-\d{2}-\d{4,}",
        r"ce-\w+[\s/]\w+\s+\d{3,}",
    ]
    lower = text.lower()
    return any(re.search(p, lower) for p in patterns)


def normalize_reg_number(num: str) -> str:
    """Strip leading zeros from registration number parts.

    Example:
        '006083/2024' -> '6083/2024'

    Args:
        num: Registration number string.

    Returns:
        Normalized string with leading zeros removed from each '/'-separated part.
    """
    parts = num.split("/")
    return "/".join(p.lstrip("0") or "0" for p in parts)


# ---------------------------------------------------------------------------
# VTEX helpers
# ---------------------------------------------------------------------------


def get_vtex_config(brand: str) -> dict[str, str] | None:
    """Resolve VTEX store config for a brand name.

    Args:
        brand: Brand name (case-insensitive).

    Returns:
        Dict with 'domain' and 'site_url', or None if not found.
    """
    brand_lower = brand.lower().strip()
    for key, config in VTEX_STORES.items():
        if key in brand_lower or brand_lower in key:
            return config
    return None


def _vtex_match_product(products: list[dict], sku: str, config: dict[str, str]) -> dict | None:
    """Find a product in VTEX results by SKU reference.

    Args:
        products: List of VTEX product dicts.
        sku: SKU to look up.
        config: VTEX store config dict.

    Returns:
        Matching product dict with _vtex_config/_search_api injected, or None.
    """
    sku_lower = sku.lower()
    for p in products:
        ref = (p.get("productReference") or "").lower()
        if ref.startswith(sku_lower) or sku_lower in ref:
            p["_vtex_config"] = config
            p["_search_api"] = "intelligent"
            return p
        for item in (p.get("items") or []):
            item_ref = (
                (item.get("referenceId") or [{}])[0].get("Value", "")
                if item.get("referenceId")
                else ""
            )
            item_name = (item.get("name") or "").lower()
            if sku_lower in item_ref.lower() or sku_lower in item_name:
                p["_vtex_config"] = config
                p["_search_api"] = "intelligent"
                return p
    return None


def vtex_search_product(sku: str, brand: str, product_name: str = "") -> dict | None:
    """Search for a product by SKU on VTEX using multiple strategies.

    Strategy order:
    1. Intelligent Search API with SKU query.
    2. Catalog System API with RefId.
    3. For numeric SKUs, Intelligent Search API with product name.

    Args:
        sku: Product SKU to search.
        brand: Brand name used to resolve the VTEX store.
        product_name: Optional product name for fallback search (numeric SKUs).

    Returns:
        VTEX product dict or None if not found.
    """
    config = get_vtex_config(brand)
    if not config:
        log.warning(f"No VTEX config for brand '{brand}'")
        return None

    domain = config["domain"]
    headers = {"Accept": "application/json", "User-Agent": "CertAPI/2.0"}
    is_numeric = sku.isdigit()

    # 1. Intelligent Search API
    try:
        url = f"https://{domain}/api/io/_v/api/intelligent-search/product_search/"
        resp = requests.get(url, params={"query": sku, "count": 5}, headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            products = data.get("products", [])
            if products:
                match = _vtex_match_product(products, sku, config)
                if match:
                    return match
                if not is_numeric:
                    products[0]["_vtex_config"] = config
                    products[0]["_search_api"] = "intelligent"
                    return products[0]
    except requests.RequestException as e:
        log.warning(f"VTEX intelligent search ({sku}) failed: {e}")

    # 2. Catalog System API
    try:
        url = f"https://{domain}/api/catalog_system/pub/products/search"
        resp = requests.get(
            url, params={"fq": f"alternateIds_RefId:{sku}"}, headers=headers, timeout=15
        )
        if resp.status_code in (200, 206):
            data = resp.json()
            if data:
                data[0]["_vtex_config"] = config
                data[0]["_search_api"] = "catalog"
                return data[0]
    except requests.RequestException as e:
        log.warning(f"VTEX catalog search ({sku}) failed: {e}")

    # 3. Name-based fallback for numeric SKUs
    if is_numeric and product_name:
        try:
            name_words = [w for w in product_name.split() if len(w) > 2][:4]
            name_query = " ".join(name_words)
            if name_query:
                url = f"https://{domain}/api/io/_v/api/intelligent-search/product_search/"
                resp = requests.get(
                    url, params={"query": name_query, "count": 10}, headers=headers, timeout=15
                )
                if resp.status_code == 200:
                    data = resp.json()
                    products = data.get("products", [])
                    if products:
                        match = _vtex_match_product(products, sku, config)
                        if match:
                            return match
        except requests.RequestException as e:
            log.warning(f"VTEX name search ({product_name}) failed: {e}")

    return None


def extract_cert_text_from_vtex(product_data: dict) -> str:
    """Extract all certification-related text from a VTEX product dict.

    Handles both Intelligent Search API and Catalog System API response formats.
    Checks description, properties, specificationGroups, and items.complementName.

    Args:
        product_data: VTEX product dict (with _search_api key injected by vtex_search_product).

    Returns:
        Pipe-separated string of unique certification fragments, or empty string.
    """
    found_texts: list[str] = []
    api_type = product_data.get("_search_api", "intelligent")

    if api_type == "intelligent":
        desc = strip_html(product_data.get("description", ""), keep_newlines=True)
        found_texts.extend(extract_cert_sentences(desc))

        for prop in (product_data.get("properties") or []):
            if isinstance(prop, dict):
                name = prop.get("name", "")
                values = prop.get("values", [])
                name_lower = name.lower().strip()
                is_cert_field = any(cn in name_lower for cn in CERT_SPEC_NAMES)
                for val in values:
                    val_str = strip_html(str(val))
                    if is_cert_field and val_str or any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(
                        kw in name_lower for kw in CERT_KEYWORDS
                    ):
                        found_texts.append(f"{name}: {val_str}")

        for group in (product_data.get("specificationGroups") or []):
            if isinstance(group, dict):
                for spec in (group.get("specifications") or []):
                    if isinstance(spec, dict):
                        name = spec.get("name", "")
                        values = spec.get("values", [])
                        name_lower = name.lower().strip()
                        is_cert_field = any(cn in name_lower for cn in CERT_SPEC_NAMES)
                        for val in values:
                            val_str = strip_html(str(val))
                            if is_cert_field and val_str or any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(
                                kw in name_lower for kw in CERT_KEYWORDS
                            ):
                                found_texts.append(f"{name}: {val_str}")

        for item in (product_data.get("items") or []):
            if isinstance(item, dict):
                comp_raw = item.get("complementName", "")
                if not comp_raw:
                    continue
                comp = strip_html(comp_raw, keep_newlines=True)
                cert_sentences = extract_cert_sentences(comp)
                if cert_sentences:
                    found_texts.extend(cert_sentences)

    else:
        # Catalog System API format
        desc = strip_html(product_data.get("description", ""), keep_newlines=True)
        found_texts.extend(extract_cert_sentences(desc))

        all_specs = product_data.get("allSpecifications", [])
        for spec_name in all_specs:
            spec_values = product_data.get(spec_name, [])
            name_lower = spec_name.lower().strip()
            is_cert_field = any(cn in name_lower for cn in CERT_SPEC_NAMES)
            if isinstance(spec_values, list):
                for val in spec_values:
                    val_str = strip_html(str(val))
                    if is_cert_field and val_str or any(kw in val_str.lower() for kw in CERT_KEYWORDS) or any(
                        kw in name_lower for kw in CERT_KEYWORDS
                    ):
                        found_texts.append(f"{spec_name}: {val_str}")

        for item in (product_data.get("items") or []):
            comp_raw = item.get("complementName", "")
            if not comp_raw:
                continue
            comp = strip_html(comp_raw, keep_newlines=True)
            cert_sentences = extract_cert_sentences(comp)
            if cert_sentences:
                found_texts.extend(cert_sentences)

    # Deduplicate preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for t in found_texts:
        t_clean = t.strip()
        if t_clean and t_clean not in seen:
            seen.add(t_clean)
            unique.append(t_clean)

    return " | ".join(unique) if unique else ""


def build_product_url(product_data: dict) -> str:
    """Build the product page URL from VTEX product data.

    Args:
        product_data: VTEX product dict with _vtex_config injected.

    Returns:
        Full product URL string, or empty string if not determinable.
    """
    config = product_data.get("_vtex_config", {})
    site_url = config.get("site_url", "")
    link = product_data.get("link", "")

    if link and link.startswith("http"):
        return link
    if link and site_url:
        return f"{site_url}{link}"
    link_text = product_data.get("linkText", "")
    if link_text and site_url:
        return f"{site_url}/{link_text}/p"
    return ""


# ---------------------------------------------------------------------------
# Comparison logic
# ---------------------------------------------------------------------------


def compare_ecommerce_description(
    ecommerce_desc: str, actual: str
) -> tuple[str, float] | None:
    """Compare the exact e-commerce description against text found on site.

    Args:
        ecommerce_desc: Expected text from the 'Descrição E-commerce' spreadsheet column.
        actual: Certification text actually found on the product page.

    Returns:
        (status, score) tuple, or None if no e-commerce description is provided.
    """
    if not ecommerce_desc:
        return None
    if not actual:
        return ("URL_NOT_FOUND", 0.0)

    desc_clean = ecommerce_desc.strip().lower()
    actual_clean = actual.strip().lower()

    if desc_clean in actual_clean:
        return ("OK", 1.0)

    codes = re.findall(r"[\w-]{4,}/[\w-]+|[\w-]+-[\w-]+-[\w-]+|\d{5,}", ecommerce_desc)
    if codes:
        normalized_codes = [normalize_reg_number(c) for c in codes]
        act_codes = re.findall(r"[\w-]{4,}/[\w-]+|[\w-]+-[\w-]+-[\w-]+|\d{5,}", actual)
        found = sum(
            1
            for nc in normalized_codes
            if nc.lower() in actual_clean
            or any(normalize_reg_number(a) == nc.lower() for a in act_codes)
        )
        if found == len(codes):
            return ("OK", 0.95)
        if found > 0:
            return ("INCONSISTENT", 0.5 + 0.3 * (found / len(codes)))

    seq_score = difflib.SequenceMatcher(None, desc_clean, actual_clean).ratio()
    if seq_score >= 0.8:
        return ("OK", seq_score)
    if seq_score >= 0.4:
        return ("INCONSISTENT", seq_score)

    return ("URL_NOT_FOUND", seq_score)


def compare_cert_texts(
    expected: str, actual: str, ecommerce_desc: str = ""
) -> tuple[str, float]:
    """Compare expected certification info against text found on site.

    Priority:
    1. Exact substring match against ecommerce_desc when available.
    2. Cert body + registration number matching using expected (certification_type).
    3. Portaria number matching.
    4. Word overlap + sequence similarity fallback.

    Args:
        expected: certification_type value from the spreadsheet.
        actual: Certification text found on the VTEX product page.
        ecommerce_desc: Optional exact 'Descrição E-commerce' text.

    Returns:
        (status, score) tuple where status is one of: OK, INCONSISTENT,
        URL_NOT_FOUND, NO_EXPECTED.
    """
    if not expected and not ecommerce_desc:
        return ("NO_EXPECTED", 0.0)
    if not actual:
        return ("URL_NOT_FOUND", 0.0)

    ecom_result = compare_ecommerce_description(ecommerce_desc, actual)
    if ecom_result is not None:
        return ecom_result

    if not expected:
        return ("NO_EXPECTED", 0.0)

    exp_lower = expected.lower().strip()
    act_lower = actual.lower().strip()

    # ENCERRAMENTO products in phase-out — always OK
    if "encerramento" in exp_lower:
        return ("OK", 1.0)

    # Specific registration numbers
    exp_reg_numbers = re.findall(r"\d{4,}/\d{4}", expected)
    if exp_reg_numbers:
        act_reg_numbers = re.findall(r"\d{4,}/\d{4}", actual)
        norm_act = {normalize_reg_number(n) for n in act_reg_numbers}
        found_count = sum(
            1
            for num in exp_reg_numbers
            if num in actual or normalize_reg_number(num) in norm_act
        )
        if found_count == len(exp_reg_numbers):
            return ("OK", 1.0)

    exp_bodies = extract_cert_bodies(expected)
    act_bodies = extract_cert_bodies(actual)
    matching_bodies = exp_bodies & act_bodies
    actual_has_reg = has_registration_number(actual)

    if matching_bodies and actual_has_reg:
        return ("OK", 0.95)
    if matching_bodies and not actual_has_reg:
        return ("INCONSISTENT", 0.6)
    if not exp_bodies and act_bodies and actual_has_reg:
        return ("OK", 0.9)

    # Portaria numbers
    portaria_expected = re.findall(r"portaria\s*(?:n[°º.]?\s*)?(\d+)", exp_lower)
    if portaria_expected:
        portaria_found = all(
            re.search(rf"(?:portaria|port\.?)\s*(?:n[°º.]?\s*)?{num}", act_lower)
            for num in portaria_expected
        )
        if portaria_found:
            return ("OK", 0.9)

    exp_words = {w for w in re.findall(r"\w+", exp_lower) if len(w) > 3}
    act_words = {w for w in re.findall(r"\w+", act_lower) if len(w) > 3}
    word_score = len(exp_words & act_words) / len(exp_words) if exp_words else 0.0
    seq_score = difflib.SequenceMatcher(None, exp_lower, act_lower).ratio()
    score = max(word_score, seq_score)

    if actual_has_reg and score >= 0.2:
        score = max(score, 0.5)

    if score >= 0.7:
        return ("OK", score)
    if score >= 0.3:
        return ("INCONSISTENT", score)
    return ("URL_NOT_FOUND", score)


def validate_single_product(
    sku: str,
    brand: str,
    expected_cert: str,
    product_name: str = "",
    ecommerce_description: str = "",
    sheet_status: str = "",
    is_expired: bool = False,
    sale_deadline_date: str = "",
) -> dict:
    """Validate a single product certification against its VTEX e-commerce page.

    Args:
        sku: Product SKU.
        brand: Brand name used to resolve VTEX store.
        expected_cert: certification_type from the spreadsheet.
        product_name: Product name used as fallback for numeric SKU searches.
        ecommerce_description: Exact 'Descrição E-commerce' text for precise matching.
        sheet_status: Status value from the spreadsheet (unused in logic, kept for context).
        is_expired: Whether this product is marked as expired.
        sale_deadline_date: Sale deadline date string for expired products.

    Returns:
        Dict with keys: sku, brand, status, score, url, actual_cert_text,
        expected_cert_text, ecommerce_description, error, verified_at.
    """
    now = datetime.now(UTC)
    result: dict = {
        "sku": sku,
        "brand": brand,
        "status": "URL_NOT_FOUND",
        "score": 0.0,
        "url": None,
        "actual_cert_text": None,
        "expected_cert_text": expected_cert or None,
        "ecommerce_description": ecommerce_description or None,
        "error": None,
        "verified_at": now.isoformat(),
    }

    if is_expired and sale_deadline_date:
        result["status"] = "EXPIRED"
        result["error"] = f"Certificado vencido - prazo final venda: {sale_deadline_date}"
        return result

    if not expected_cert and not ecommerce_description:
        result["status"] = "NO_EXPECTED"
        return result

    config = get_vtex_config(brand)
    if not config:
        result["status"] = "API_ERROR"
        result["error"] = f"No VTEX store configured for brand '{brand}'"
        return result

    try:
        vtex_product = vtex_search_product(sku, brand, product_name=product_name)
    except Exception as e:
        result["status"] = "API_ERROR"
        result["error"] = f"VTEX API error: {e!s}"
        return result

    if not vtex_product:
        result["status"] = "URL_NOT_FOUND"
        result["error"] = f"Product SKU {sku} not found on {config['domain']}"
        return result

    result["url"] = build_product_url(vtex_product)
    actual_cert = extract_cert_text_from_vtex(vtex_product)
    result["actual_cert_text"] = actual_cert if actual_cert else None

    status, score = compare_cert_texts(expected_cert, actual_cert, ecommerce_description)
    result["status"] = status
    result["score"] = round(score, 3)

    if status == "URL_NOT_FOUND" and result["url"]:
        result["error"] = "No certification text found on product page"
    elif status == "INCONSISTENT":
        result["error"] = "Certification text found but does not match expected"

    return result
