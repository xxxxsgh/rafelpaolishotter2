# Rafa Paoli's Shooter

Dois jogos, um repositório:

| Jogo | Arquivo | Descrição |
|------|---------|-----------|
| **Rafa Paoli's Shooter — Ultimate V2** | [`index.html`](index.html) | O jogo original expandido: campanha, galaxy explorer, infinite, survivor, boss rush, co-op online, PvP. |
| **Rafa Paoli's Shooter II — Neon Genesis** | [`sequel.html`](sequel.html) | **A sequência.** Engine reescrita do zero, 16 chefes multi-fase, 9 modos, roguelite, gráficos e áudio novos. |

## Shooter II — Neon Genesis

Sequência completa, num único arquivo HTML, sem dependências externas (só as fontes do Google).

### O que mudou em relação ao V2

**Motor / gráficos**
- Renderização em resolução virtual 1280×720 com letterbox — mesma imagem em qualquer tela.
- Passe aditivo de brilho, partículas com física (faíscas, destroços, fumaça, ondas de choque), rastros, tremor de câmera, *hitstop*, flashes e vinheta.
- Fundo paralaxe em camadas: nebulosa procedural sem emenda, grade em perspectiva e campo de estrelas com profundidade — tema próprio para cada um dos 10 setores.
- Naves, inimigos e chefes desenhados em vetor com formas exclusivas e animação por peça.
- Loop com passo de tempo real (delta time): mesma velocidade de jogo em 30, 60 ou 144 Hz.

**Gameplay**
- Movimento livre em 8 direções (o V2 era só esquerda/direita).
- **Dash** com invencibilidade, **Foco** (movimento lento + tiro concentrado), **Bomba** e **Overdrive** (ultimate por piloto).
- **Graze**: passar raspando nas balas inimigas carrega o Overdrive e dá pontos — recompensa jogar perto do perigo.
- **Combo** até ×8 multiplicando pontos e créditos, com bônus de "onda perfeita".
- 7 armas com 5 níveis, 30 módulos roguelite, 14 upgrades permanentes.

**Conteúdo**
- **16 chefes** (contra 12), cada um com **3 fases** e ataques próprios — 24 padrões de ataque diferentes (espirais, muros com brecha, feixes giratórios, gravidade, ecos temporais, invocações…).
- **12 pilotos** (contra 8), cada um com ultimate exclusiva.
- **14 tipos de inimigo** com comportamentos distintos, incluindo elites.
- **9 modos**: Campanha, Endless, Boss Rush, Survival, Time Attack, Desafio Diário (com semente e modificadores do dia), Gauntlet roguelite, Co-op local e PvP Duelo.
- 10 cascos, 26 feitos, códex de chefes/inimigos/história, 4 dificuldades.

**Áudio**
- Trilha sonora procedural que reage ao jogo (muda de intensidade em combate e em luta de chefe) e efeitos sintetizados via Web Audio — nenhum arquivo de som para baixar.

**Controles**
- Teclado (2 jogadores), gamepad (2 controles) e toque com analógico virtual.

### Controles

| Ação | P1 | P2 |
|------|----|----|
| Mover | `WASD` / setas | setas |
| Atirar | `Espaço` / `J` (auto-fire ligado por padrão) | `0` |
| Dash | `Shift` / `K` | `.` |
| Bomba | `Q` / `L` | `/` |
| Ultimate | `E` / `;` | `Enter` |
| Foco | `F` | — |
| Pausa | `P` / `Esc` | — |

### Como jogar
Abra `sequel.html` no navegador (ou o `index.html` e clique em **JOGAR A SEQUÊNCIA**). O progresso — créditos, pilotos, cascos, upgrades e feitos — fica salvo no navegador.
