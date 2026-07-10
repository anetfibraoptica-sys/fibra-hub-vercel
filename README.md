# Fibra+ Hub

## Correção atual
- Excluir boleto integrado agora cancela primeiro na Efí via `PUT /v1/charge/:id/cancel`.
- Somente após cancelamento confirmado o registro é removido do Supabase.
- Pix Copia e Cola usa o campo oficial Efí `data.pix.qrcode`.
