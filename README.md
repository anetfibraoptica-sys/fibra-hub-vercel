# Fibra+ Hub

## Alteração atual
- Adicionado botão único `Sincronizar boletos importados com a Efí` no Financeiro Efí.
- Criado endpoint `POST /api/efi/sincronizar-importados`.
- A sincronização busca boletos importados ainda sem `efi_charge_id`, consulta cobranças na Efí e vincula apenas correspondências seguras.
- Não foram alterados MikroTik, servidores, clientes, menu ou layout global.
