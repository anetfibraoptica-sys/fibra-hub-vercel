# Fibra+ Hub

## Correção atual
- Boletos com `efi_charge_id` não entram mais na busca antiga por nome/valor/vencimento.
- Pix e status Efí já salvos não são mais sobrescritos por vazio.
- `Integrado na Efí - boleto não localizado` fica restrito a boletos antigos sem charge ID.
- Para boletos Efí válidos, o status padrão preservado é `Aguardando pagamento`.
