# Paulon - Planejador Academico Unificado Livre ONline

Este repositório contém o código-fonte e os artefatos do projeto, desenvolvido e apresentado como Trabalho de Conclusão de Curso (TCC) para o curso de Ciência da Computação da UFSC. O projeto foca na geração, processamento e visualização de estruturas curriculares acadêmicas na forma de grafos, facilitando a análise de dependências e o planejamento de estudos.

# Tecnologias

* **Frontend**: Next.js (React)
* **Backend (Processamento)**: Ktor (Kotlin) com scripts Python
* **Banco de Dados**: Neo4j

## 1. Pré-requisitos

Antes de começar, garanta que você tenha os seguintes softwares instalados:

* **Git**: Para clonar o repositório.
* **Docker e Docker Compose**: Essencial para rodar o ambiente.
    * *Recomendação (macOS):* [Docker Desktop](https://www.docker.com/products/docker-desktop/) ou [Colima](https://github.com/abiosoft/colima). (É recomendado alocar pelo menos 8GB de RAM para o Docker).

## 2. Configuração Inicial (Passo a passo)

### Passo 1: Clonar o Repositório

```bash
git clone [https://github.com/matheusnovx/curriculum_graph_generator.git](https://github.com/matheusnovx/curriculum_graph_generator.git)
cd curriculum_graph_generator
```

## 2. Como Rodar o Projeto

O projeto agora é executado em duas etapas: primeiro, subimos os serviços principais; segundo, rodamos o script para popular o banco de dados.

### Passo 1: Iniciar os Serviços Principais

Execute o comando abaixo na raiz do projeto. Isso irá construir as imagens e iniciar os serviços `frontend`, `backend`, e `neo4j`.

```bash
docker-compose up -d --build
```

* O `docker-compose.yml` está configurado com `profiles`, então este comando **NÃO** irá rodar o populador do banco.
* O serviço `backend` irá iniciar, mas ficará em modo de espera (com `tail -f`).
* O banco de dados `neo4j` estará **vazio** neste momento.

### Passo 2: Popular o Banco de Dados

Depois que tudo estiver rodando, você pode usar os seguintes comandos (em um segundo terminal) para popular o banco:

### 1. Para rodar o `Main.kt` (Processador de Currículos via Gradle):

```bash
docker-compose exec -w /app/curriculum-graph-processor backend ./gradlew run
```

### 2. Para rodar o `atualizar_turmas.py` (Script Python direto):

Este comando executa o interpretador `python3` e passa o caminho absoluto do script dentro do contêiner `backend`.

```bash
docker-compose exec backend python3 /app/curriculum-graph-processor/src/main/scripts/atualizar_turmas.py
```

Por segurança rode novamente:

```bash
docker-compose up -d --build
```

**Você só precisa executar o Passo 2 uma vez.** Os dados serão salvos permanentemente no volume `neo4j_data`.

## 3. Acessando a Aplicação

Após os passos acima, a aplicação estará disponível nos seguintes endereços:

* **Aplicação Frontend**: `http://localhost:3000`
* **Banco de Dados (Neo4j Browser)**: `http://localhost:7474`
    * *Nota: A autenticação foi desabilitada (`NEO4J_AUTH=none`). Você pode se conectar sem usuário ou senha.*

## 4. Comandos Úteis

### Parar a Aplicação

Para parar todos os contêineres:

```bash
docker-compose down
```

### Resetar o Banco de Dados

```bash
docker-compose down -v
```

Execute o **Passo 2** novamente para repopular o banco.

### Ver os Logs

Para ver os logs de todos os serviços em tempo real:

```bash
docker-compose logs -f
```

Para ver os logs de um serviço específico (ex: `frontend`):

```bash
docker-compose logs -f frontend
```
