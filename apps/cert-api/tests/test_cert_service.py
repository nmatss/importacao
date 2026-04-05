"""Tests for certification comparison logic."""

import pytest

from app.services.cert_service import (
    compare_cert_texts,
    compare_ecommerce_description,
    extract_cert_bodies,
    extract_cert_sentences,
    has_registration_number,
    normalize_reg_number,
    strip_html,
)


class TestStripHtml:
    def test_removes_tags(self):
        assert strip_html("<b>hello</b>") == "hello"

    def test_empty_string(self):
        assert strip_html("") == ""

    def test_keep_newlines_on_block_tags(self):
        result = strip_html("<p>line1</p><p>line2</p>", keep_newlines=True)
        assert "line1" in result
        assert "line2" in result

    def test_unescape_entities(self):
        assert "&amp;" not in strip_html("a &amp; b")


class TestExtractCertSentences:
    def test_extracts_inmetro_fragment(self):
        text = "Produto bonito. Certificado INMETRO Nº 123. Cor azul."
        result = extract_cert_sentences(text)
        assert any("inmetro" in r.lower() or "certificado" in r.lower() for r in result)

    def test_empty_text(self):
        assert extract_cert_sentences("") == []

    def test_no_cert_keywords(self):
        assert extract_cert_sentences("Produto bonito. Cor azul. Qualidade premium.") == []


class TestNormalizeRegNumber:
    def test_strips_leading_zeros(self):
        assert normalize_reg_number("006083/2024") == "6083/2024"

    def test_no_leading_zeros(self):
        assert normalize_reg_number("6083/2024") == "6083/2024"

    def test_zero_only(self):
        assert normalize_reg_number("0/0") == "0/0"


class TestExtractCertBodies:
    def test_inmetro(self):
        assert "inmetro" in extract_cert_bodies("Certificado INMETRO")

    def test_anvisa(self):
        assert "anvisa" in extract_cert_bodies("Registro ANVISA 12345")

    def test_ocp_implies_inmetro(self):
        assert "inmetro" in extract_cert_bodies("OCP 0098")

    def test_empty(self):
        assert extract_cert_bodies("") == set()


class TestHasRegistrationNumber:
    def test_slash_format(self):
        assert has_registration_number("Registro 006083/2024")

    def test_n_format(self):
        assert has_registration_number("Nº 12345")

    def test_anatel_format(self):
        assert has_registration_number("Anatel: 07388-24-15956")

    def test_no_number(self):
        assert not has_registration_number("Produto sem certificação")


class TestCompareEcommerceDescription:
    def test_exact_match(self):
        status, score = compare_ecommerce_description("Registro Inmetro 010208/2024", "Registro Inmetro 010208/2024 presente")
        assert status == "OK"
        assert score == 1.0

    def test_no_desc_returns_none(self):
        assert compare_ecommerce_description("", "anything") is None

    def test_no_actual_returns_not_found(self):
        status, score = compare_ecommerce_description("Registro Inmetro 010208/2024", "")
        assert status == "URL_NOT_FOUND"

    def test_code_match(self):
        status, score = compare_ecommerce_description("010208/2024", "O produto tem o código 010208/2024 aprovado")
        assert status == "OK"


class TestCompareCertTexts:
    def test_no_expected_returns_no_expected(self):
        status, score = compare_cert_texts("", "some text")
        assert status == "NO_EXPECTED"

    def test_no_actual_returns_url_not_found(self):
        status, score = compare_cert_texts("INMETRO", "")
        assert status == "URL_NOT_FOUND"

    def test_matching_inmetro_with_reg_number(self):
        status, score = compare_cert_texts(
            "INMETRO BRINQUEDOS",
            "Certificação INMETRO Nº 006083/2024",
        )
        assert status == "OK"
        assert score >= 0.9

    def test_encerramento_with_actual_always_ok(self):
        # ENCERRAMENTO products return OK when actual cert text is present on the page
        status, score = compare_cert_texts("ENCERRAMENTO - Prazo: 01/06/2024", "Certificado INMETRO Nº 006083/2024")
        assert status == "OK"

    def test_encerramento_empty_actual_is_url_not_found(self):
        # When actual is empty, URL_NOT_FOUND fires before ENCERRAMENTO logic
        status, score = compare_cert_texts("ENCERRAMENTO - Prazo: 01/06/2024", "")
        assert status == "URL_NOT_FOUND"

    def test_inconsistent_same_body_no_reg(self):
        status, score = compare_cert_texts("INMETRO BRINQUEDOS", "Produto com certificação INMETRO")
        assert status == "INCONSISTENT"

    def test_ecommerce_desc_takes_priority(self):
        status, score = compare_cert_texts(
            "INMETRO",
            "Registro Inmetro 010208/2024",
            ecommerce_desc="Registro Inmetro 010208/2024",
        )
        assert status == "OK"
