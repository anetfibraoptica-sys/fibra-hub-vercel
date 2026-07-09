# Fibra+ Hub

## Correção atual
- A consulta do boleto importado agora envia as credenciais Efí salvas no navegador para o backend.
- O backend tenta localizar o boleto na Efí por charge_id direto e, se não achar, busca por lista usando emissão/vencimento, cliente e valor.
- Depois de localizar, busca o detalhe para preencher Linha Digitável, Pix Copia e Cola e Segunda Via.
- Esta correção foi feita para boletos importados do ReceitaNet que já existem na Efí, mas não trouxeram o charge_id no painel.
