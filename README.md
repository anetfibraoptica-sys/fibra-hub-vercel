# Fibra+ Hub

## Correção atual
- Criado endpoint `/api/efi/boleto-importado/consultar`.
- Ao abrir boleto importado, o sistema consulta a Efí pelo número/charge_id e tenta preencher situação, linha digitável e Pix Copia e Cola.
- O texto `Aguardando integração` deixa de ser fixo e passa a ser substituído pelo retorno da Efí.
- Botão Segunda Via abre o link da Efí quando o backend retornar o link.

Observação: se a Efí exigir endpoint/certificado específico para detalhe de boletos, o retorno poderá vir como `Não encontrado na Efí`; neste caso será necessário ajustar o endpoint conforme o produto Efí habilitado na conta.
