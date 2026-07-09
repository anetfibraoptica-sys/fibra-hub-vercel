# Fibra+ Hub

## Correção atual
- A busca do boleto importado na Efí agora também consulta `/v1/transactions`.
- A janela de busca foi ampliada para 180 dias antes/depois da emissão ou vencimento.
- A correspondência foi reforçada por cliente, valor, vencimento e número.
- O detalhe agora tenta `/v1/charge`, `/v1/charge/detail`, `/v1/transaction` e `/v1/transactions`.
- Quando não localizar, envia debug no console para identificar qual dado falta.
