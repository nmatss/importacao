"""Sincroniza o PRAZO FINAL VENDA da planilha com a validade do produto no Linx.

O time fiscal mantem o prazo final de venda na aba "Encerramentos"; o Linx guarda o
mesmo dado na propriedade VALIDADE DO CERTIFICADO (00224 Puket / 00106 Imaginarium),
que vinha sem ser atualizada. Este script reconcilia os dois.

DRY-RUN por padrao: sem `--apply`, nada e escrito no ERP.

Uso (no servidor):

    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py
    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --brand puket
    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --apply

Produtos cujo prazo da planilha e ANTERIOR ao que esta no Linx aparecem como
"encurta janela" e NUNCA sao gravados por este script — tirar dias de venda de um
produto e decisao de negocio, nao efeito colateral de sync. Doc: docs/CERT-LINX-WRITE.md
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import REPORTS_DIR  # noqa: E402
from app.services.linx_service import sync_prazo_venda_to_linx  # noqa: E402


def _salvar_relatorio(resultado: dict) -> Path:
    """Grava o antes/depois de cada SKU — e o unico caminho de volta.

    O Linx nao versiona PROP_PRODUTOS: sem este arquivo, sobrescrever a validade de
    centenas de produtos e irreversivel. Cada item carrega `valor_atual` (o valor
    que estava la) e `prazo` (o que foi gravado).
    """
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = Path(REPORTS_DIR) / f"sync-prazo-linx-{stamp}.json"
    path.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="grava de fato (sem isso, so simula)")
    ap.add_argument("--brand", default=None, help="limita a uma marca (ex.: puket)")
    ap.add_argument("--list", action="store_true", help="lista item a item")
    args = ap.parse_args()

    modo = "APLICANDO NO LINX" if args.apply else "DRY-RUN (nada sera escrito)"
    print(f"== Sync prazo final de venda -> Linx — {modo} ==\n")

    r = sync_prazo_venda_to_linx(dry_run=not args.apply, brand_filter=args.brand)
    if r["error"]:
        print(f"ERRO: {r['error']}", file=sys.stderr)
        return 1

    total = sum(r["counts"].values())
    print(f"{total} SKUs avaliados\n")
    for acao, n in sorted(r["counts"].items(), key=lambda x: -x[1]):
        print(f"  {acao:34} {n:4}")

    if r["encurta_janela"]:
        print(
            f"\n!! {len(r['encurta_janela'])} produto(s) em que a planilha ENCURTA a janela de venda."
        )
        print("   Nao foram gravados. Precisam de decisao de negocio:")
        print(f"   {'SKU':12} {'Linx hoje':12} {'planilha':12} {'dias a menos':>12}")
        for it in sorted(r["encurta_janela"], key=lambda x: -x["dias_a_menos"])[:15]:
            print(
                f"   {it['sku']:12} {str(it['valor_atual']):12} {it['prazo']:12} {it['dias_a_menos']:>12}"
            )

    if args.list:
        print(f"\n{'SKU':12} {'MARCA':13} {'PRAZO':12} {'LINX HOJE':12} ACAO")
        for it in r["items"]:
            print(
                f"{it['sku']:12} {it['brand'][:12]:13} {it['prazo']:12} "
                f"{str(it['valor_atual'] or '-'):12} {it['acao']}"
            )

    if args.apply:
        path = _salvar_relatorio(r)
        print(f"\nAntes/depois de cada SKU salvo em: {path}")
        print("   (guarde: e o unico caminho de rollback — o Linx nao versiona PROP_PRODUTOS)")
    else:
        print("\nNada foi escrito. Para gravar de fato: --apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
