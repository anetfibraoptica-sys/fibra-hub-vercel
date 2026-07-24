function entrar(){
  const login = document.getElementById('login').value;
  const senha = document.getElementById('senha').value;

  if(login && senha){
    document.getElementById('msg').innerText =
      'Estrutura da Central criada. Próxima etapa: conectar ao Supabase.';
  }
}