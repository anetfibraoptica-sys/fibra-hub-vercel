# Fibra+ Hub

## Correção atual
- O Pix Copia e Cola agora é capturado diretamente da resposta `POST /v1/charge/:id/pay`.
- O campo oficial priorizado é `data.pix.qrcode`.
- Consultas posteriores não sobrescrevem o Pix com vazio.
- O Pix é salvo em `boletos.pix`, `dados.pix`, `dados.codigoPix` e `dados.pixCopiaCola`.
