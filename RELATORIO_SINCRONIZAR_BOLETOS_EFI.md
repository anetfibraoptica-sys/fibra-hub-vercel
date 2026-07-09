# Relatório - Sincronizar boletos importados com a Efí

## O que foi feito
- Botão no Financeiro Efí: `Sincronizar boletos importados com a Efí`.
- Endpoint: `POST /api/efi/sincronizar-importados`.
- O endpoint lê boletos importados no Supabase, busca cobranças na Efí por período e compara CPF/CNPJ, valor, vencimento e nome.
- Só grava vínculo quando a correspondência é segura.

## Campos atualizados no boleto
- `efi_charge_id`
- `efi_status`
- `linha_digitavel`
- `pix`
- `link_pdf`
- `dados.efiChargeId`

## Validação
- node --check: OK
- Rotas totais: 39
