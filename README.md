# Fibra+ Hub

## Alteração atual
- Ao clicar em `Gravar no Fibra+ Hub + Servidor`, o sistema envia o PROFILE selecionado ao MikroTik.
- Se o PPP Secret do login já existir, atualiza o `profile`.
- Se o PPP Secret não existir, cria o cliente PPPoE com login, senha, service=pppoe e profile selecionado.
- Valida se o profile existe no MikroTik antes de aplicar.
- Não altera o profile apenas ao selecionar; só grava ao clicar no botão vermelho.

Depois de publicar na Vercel, faça Ctrl+F5.
