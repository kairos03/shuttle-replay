# Fisica della traiettoria

Una telecamera vede un volano come un pixel. Ogni punto lungo la linea di
vista che passa per quel pixel, vicino o lontano, cade sullo stesso pixel,
quindi un singolo fotogramma non può indicare la profondità. Questa pagina
spiega come `shuttle-replay` trasforma comunque una sequenza di pixel in un
volo 3D, aggiungendo fisica e vincoli revisionati, e cosa il risultato
significa e non significa.

## Il problema inverso

Pensa a ogni rilevazione come a un raggio che parte dalla telecamera. Un volo
è una curva che deve passare vicino a ogni raggio nell'istante giusto. Molte
curve possono farlo: un volo lento e vicino e uno veloce e lontano possono
produrre tracce di pixel simili. Il problema è sottodeterminato. Lo strumento
sceglie una curva richiedendo che:

- rispetti la gravità e la resistenza dell'aria (il modello qui sotto),
- parta vicino alla posizione e all'altezza del contatto revisionato,
  all'istante del contatto revisionato,
- sia attratta in modo morbido verso il contatto revisionato successivo o
  verso una zona di atterraggio revisionata, oppure si fermi alla fine della
  finestra osservata (i residui degli estremi sono penalità, non requisiti
  rigidi di accettazione), e
- resti sopra il pavimento e superi la rete quando deve attraversarla.

La traiettoria 3D stimata è quindi un **modello condizionale**: la curva più
coerente data la tua calibrazione e la tua revisione, non una misura
([docstring del modulo `analysis.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## Il modello di volo

Lo stato è la posizione `r = (x, y, z)` in metri e la velocità `v` in m/s. Le
equazioni del moto
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)):

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

La resistenza è opposta al moto e cresce con il quadrato della velocità. Una
lettura utile di `k`: un volano che cade in verticale smette di accelerare
quando la resistenza eguaglia la gravità, alla velocità terminale
`sqrt(g / k)`. Con il prior predefinito `k = 0.18 1/m` sono circa 7.4 m/s. Un
volano colpito ad alta velocità quindi rallenta bruscamente; il modello non
include rotazione, ribaltamento né vento.

I sette parametri stimati sono `[x, y, z, vx, vy, vz, k]` al **tempo di volo
zero**, cioè l'istante del contatto revisionato, non quello della prima
rilevazione
([docstring del modulo `physics.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
Le rilevazioni spesso iniziano qualche fotogramma dopo il contatto perché la
racchetta o un giocatore nasconde il volano. Quei fotogrammi sono misurati
come scostamenti dal contatto, quindi una prima rilevazione tardiva non sposta
l'inizio del volo (`first_observation_delay_s` riporta l'intervallo).

## Integrazione numerica

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
integra le equazioni con `solve_ivp` di SciPy (il suo metodo Runge-Kutta
esplicito predefinito) a partire da `t = 0`, con `rtol=1e-7`, `atol=1e-8`,
`max_step=0.02` secondi e output denso, poi valuta le posizioni negli istanti
richiesti. Tempi non finiti e tempi sotto `-1e-9` s vengono rifiutati; valori
negativi minimi sopra quella soglia vengono portati a zero. Le tolleranze del
risolutore controllano l'errore di integrazione numerica; non sono limiti
sull'accuratezza della ricostruzione.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
usa una funzione evento su `z` (solo discendente, terminale) con tolleranze
più strette (`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`) su un orizzonte di
10 s.

## Cosa viene minimizzato

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
costruisce un unico vettore di residui. Ogni voce è una differenza divisa per
una scala, quindi "1" significa "un errore atteso":

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` è la durata del volo. Il prior del contatto viene da
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54):
se il contatto ha `image_px`, il raggio che passa per quel pixel viene
intersecato con il piano alla `height_m` revisionata; altrimenti si usano
direttamente `court_xy_m` e `height_m`. Le sigma vengono da `xy_sigma_m` e
`height_sigma_m` di ciascun contatto, con i valori predefiniti indicati in
mancanza.

Nel termine della rete, `h_net` è l'altezza interpolata nel punto in cui la
traiettoria a 41 campioni attraversa per la prima volta `Y = 6.70`; se la
traiettoria non attraversa mai, `h_net` vale 0. Questo termine usa 1.55 m
(altezza del palo) come scritto nel codice; il gate di accettazione più sotto
usa 1.524 m (centro della rete).

`least_squares` di SciPy minimizza la somma con `loss="soft_l1"` e
`f_scale=1.5`, così poche rilevazioni sbagliate pesano meno che con i quadrati
semplici. Parte da sei punti iniziali: `k` in `0.1, 0.2, 0.35` combinato con
una velocità extra verso l'alto di `1.0` o `3.0` m/s aggiunta a una stima
balistica verso l'obiettivo finale. Vince il risultato a costo minore. I
limiti mantengono la ricerca fisicamente plausibile
([codice](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)):

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

I sette parametri di stato/resistenza vengono segnalati in
`parameters_at_bound` quando la loro distanza da un limite è inferiore allo
0.1% del loro intervallo consentito
([codice](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
Un fit segnalato viene rifiutato. Il tempo di atterraggio non è incluso in
questa diagnostica. Superarla non stabilisce identificabilità, unicità né
assenza di influenza dei prior.

## Come finisce un volo

I voli vengono costruiti per segmento di telecamera a partire dai contatti in
ordine temporale
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)):

- **`intercepted_by_next_contact`**: segue un altro contatto nello stesso
  segmento. La durata è il tempo tra i contatti; la fine è attratta verso il
  prior del contatto successivo. È richiesto un attraversamento della rete
  quando i due prior di contatto si trovano su lati opposti della rete.
- **`landing_region`**: l'ultimo contatto di un segmento ha una fine di
  atterraggio revisionata. I residui del contatto e dell'estremo di
  atterraggio attraggono in modo morbido il fit verso l'estremo revisionato.
  Il tempo di atterraggio è limitato dall'intervallo revisionato, ma l'altezza
  dell'estremo e l'appartenenza alla zona non sono requisiti rigidi di
  accettazione. `landing.within_region` riporta l'appartenenza con una
  tolleranza di 1 mm; non controlla l'accettazione. È richiesto un
  attraversamento quando l'inizio e il centro della zona si trovano su lati
  opposti della rete.
- **`open_segment_end`**: qualsiasi altro caso. La finestra termina alla fine
  del segmento o a `until_s`, la durata del fit è lo scostamento dell'ultima
  osservazione e non è richiesto alcun attraversamento della rete.

Meno di `min_observations` (predefinito 4) rilevazioni nella finestra danno
`status: "insufficient_observations"` senza fit.

## Gate di accettazione

Dopo il fit, la traiettoria viene campionata in 201 punti e verificata da
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106):
`floor_ok` richiede che il punto più basso sia a -0.02 m o più in alto.
`net_ok` richiede un attraversamento quando era necessario, e **ogni**
attraversamento rilevato tra campioni adiacenti deve essere a 1.524 m o più in
alto, che un attraversamento fosse atteso o no. Un volo viene accettato solo
se l'ottimizzatore riporta successo, entrambi i gate sono superati, l'RMS di
riproiezione è al massimo `max_accept_rms_px` (predefinito 8.0 px) e nessuno
dei sette parametri di stato/resistenza è segnalato. I voli rifiutati
conservano i parametri per l'ispezione ma non vengono disegnati come livello
del modello.

## Velocità e atterraggio controfattuale

`model_speed_km_h` è `|v(0)| * 3.6`, la velocità iniziale del modello, e
`model_speed_coarse_km_h` la arrotonda ai 5 km/h più vicini per la
visualizzazione. Non è una lettura radar.

Per i voli che non terminano in una zona di atterraggio, se il modello
raggiungesse il pavimento dopo la fine del volo, l'analisi aggiunge
`unreturned_floor_crossing_prediction` con
`kind: "counterfactual_if_unreturned"` e `observed: false`. Risponde a "dove
atterrerebbe questo modello se nessuno lo avesse ribattuto", non a dove è
andato il volano. Per i voli con atterraggio, `landing.xy_m` è il punto finale
del modello attratto in modo morbido verso la tua zona (non è garantito che vi
cada dentro), e `exact_coordinate_measured` è sempre `false`.

Correlati: [Calibrazione della telecamera](camera-calibration.md) per `P`,
[Osservazioni e tempi](observations-timing.md) per la finestra di
osservazione, [Validazione e limiti](validation-limits.md) per interpretare
`fit` e `gates`.
