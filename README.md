# Fibra+ Hub

## Alteração atual
- Bloqueio agora usa profile `BLOQUEADO` no MikroTik, mantendo `disabled=no`.
- O cliente bloqueado continua autenticando e pode aparecer online, porém sem acesso conforme o profile BLOQUEADO.
- Liberar, Confiança e Pagamento retornam o cliente ao profile cadastrado na aba Servidor.
- Após trocar profile, a sessão ativa é derrubada para reconectar já no novo profile.
- Baixa manual, boleto pago ou PIX confirmado tentam desbloquear automaticamente no MikroTik.
- Cobrança proporcional usa o campo Início da Cobrança + Dia do Vencimento para calcular o primeiro ciclo.

Depois de publicar na Vercel, faça Ctrl+F5.
