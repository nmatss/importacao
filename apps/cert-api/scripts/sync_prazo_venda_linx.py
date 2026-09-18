"""Reconcilia o FIM DE VENDA da planilha com a propriedade de certificacao do Linx.

O time fiscal mantem o fim de venda na aba "Encerramentos"; o Linx guarda a trava
de faturamento na propriedade de certificacao (00224 Puket / 00106 Imaginarium).
Este script compara os dois e produz o relatorio antes/depois POR SKU.

DRY-RUN por padrao: nada e escrito no ERP. A preparacao concluida salva um
relatorio JSON em REPORTS_DIR para revisao fiscal. `--apply` permanece bloqueado
ate existir baseline, plano aprovado, conciliacao e recuperacao verificadas.

Uso (no servidor):

    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --list
    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --brand puket
    docker exec importacao-cert-api python scripts/sync_prazo_venda_linx.py --apply

Grupos que NUNCA sao gravados, nem com --apply (decisao fiscal, reuniao 11/09):
  - "limpar: ativo" / "bloqueado: certificado ativo": o certificado esta ATIVO
    (coluna U) e portanto NAO pode ter data de certificacao no Linx. Quando ja ha
    data, o relatorio propoe 01/01/1900 (a sentinela do proprio ERP).
  - "dupla certificacao": o encerramento e de um certificado DIFERENTE do vigente.
  - "encurta janela": o prazo da planilha e anterior ao que ja esta no Linx, entao
    gravar tira dias de venda do produto.
  - "ambiguo": o mesmo SKU aparece em encerramentos com prazos diferentes.
Doc: docs/CERT-LINX-WRITE.md
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.linx_service import sync_prazo_venda_to_linx  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="bloqueado ate aprovacao e recuperacao verificadas")
    ap.add_argument("--brand", default=None, help="limita a uma marca (ex.: puket)")
    ap.add_argument("--list", action="store_true", help="lista item a item")
    args = ap.parse_args()

    modo = "APPLY BLOQUEADO (nada sera escrito)" if args.apply else "DRY-RUN (nada sera escrito)"
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
        print(f"\n!! {len(r['encurta_janela'])} produto(s) em que a planilha ENCURTA a janela de venda.")
        print("   Nao foram gravados. Precisam de decisao de negocio:")
        print(f"   {'SKU':12} {'Linx hoje':12} {'planilha':12} {'dias a menos':>12}")
        for it in sorted(r["encurta_janela"], key=lambda x: -x["dias_a_menos"])[:15]:
            print(f"   {it['sku']:12} {str(it['valor_atual']):12} {it['prazo']:12} {it['dias_a_menos']:>12}")

    if r["ambiguos"]:
        print(f"\n!! {len(r['ambiguos'])} SKU(s) com prazos ou vinculos de certificado a conferir.")
        print("   Nao foram gravados — qual certificado vale e decisao de negocio:")
        for it in r["ambiguos"]:
            if "certificados" in it:
                certificados = ", ".join(it["certificados"])
            else:
                certificados = (
                    f"encerramento={it.get('certificado_encerramento') or '(nao informado)'}; "
                    f"vigente={it.get('certificado_vigente') or '(nao informado)'}"
                )
            print(f"   {it['sku']:12} prazos: {it['prazo']:26} certificados: {certificados}")

    if r["totais_por_marca"]:
        print("\nPor marca:")
        for marca, acoes in sorted(r["totais_por_marca"].items()):
            resumo = ", ".join(f"{a}: {n}" for a, n in sorted(acoes.items()))
            print(f"  {marca:14} {resumo}")

    if args.list:
        print(f"\n{'SKU':12} {'MARCA':13} {'U':10} {'PRAZO':12} {'LINX HOJE':12} {'PROPOSTO':12} ACAO")
        for it in r["items"]:
            print(
                f"{it['sku']:12} {it['brand'][:12]:13} {str(it.get('situacao') or '-')[:9]:10} "
                f"{it['prazo']:12} {str(it['valor_atual'] or '-'):12} "
                f"{str(it.get('valor_proposto') or '-'):12} {it['acao']}"
            )

    if r["report_path"]:
        print(f"\nAntes/depois de cada SKU salvo em: {r['report_path']}")
        print(f"   {len(r['diff'])} SKU(s) mudariam de valor.")
        print("   (evidencia de preparacao; nao substitui baseline completa nem recuperacao validada)")
    if not args.apply:
        print("\nNada foi escrito. --apply permanece bloqueado ate aprovacao e recuperacao verificadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
