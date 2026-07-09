# Relatório ReceitaNet → Efí

- Arquivo CSV: `relatorio (1).csv`
- Linhas: 454
- Separador: `;`
- Cabeçalhos: `Login, Nome, CPF, Dia Vencimento, Nº Boleto, Emissão, Vencimento, Pagamento, Desconto, Valor Boleto, Valor Pago, Status, Banco, Agencia-Conta/Sigla, Identificação/Carnê`

## Campos usados
- `Identificação` → `efi_charge_id` / `charge_id`
- `Carnê` → `efi_carne_id`

## Rotas
- `POST /api/efi/boleto-importado/vincular`
- `POST /api/efi/boleto-importado/consultar`

## Validação
- node --check: OK
- Rotas totais: 38
