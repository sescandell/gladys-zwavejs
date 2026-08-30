# Z-Wave JS UI

Pilotez votre réseau Z-Wave depuis Gladys, via
[Z-Wave JS UI](https://zwave-js.github.io/zwave-js-ui/) et un broker MQTT.

Cette intégration ne parle **pas** directement à votre clé Z-Wave. C'est
Z-Wave JS UI qui possède la radio et la gestion du réseau (inclusion,
exclusion, réparation, mises à jour firmware) ; cette intégration transforme
les nœuds qu'il publie en appareils Gladys, et les commandes Gladys en
commandes Z-Wave.

## Prérequis

1. **Z-Wave JS UI**, démarré et déjà appairé avec votre contrôleur Z-Wave.
2. **Un broker MQTT** (Mosquitto, EMQX…) joignable à la fois par Z-Wave JS UI
   et par Gladys.

## Configurer Z-Wave JS UI

L'intégration attend des topics MQTT nommés d'une façon précise. Ces réglages
ne sont pas configurables côté Gladys : c'est Z-Wave JS UI qui doit s'aligner.

Dans **Settings**, section **MQTT** :

- **Name** : `zwave-js-ui` — sinon le préfixe de certains topics sera erroné ;
- **Prefix** : `zwave` ;
- **Host url** / **Port** : votre broker, ainsi que l'utilisateur et le mot de
  passe s'il les exige.

![Section MQTT](./images/zwavejs-ui-mqtt-configuration.jpg)

Puis, section **Gateway**, exactement ces paramètres :

- **Topic type** : `Named topics` ;
- **Payload type** : `Entire Z-Wave value Object` ;
- **Send Z-Wave events** : activé ;
- **Include Node info** : activé ;
- **Publish node details** : activé ;
- **Ignore location** et **Ignore status updates** : désactivés.

![Section Gateway](./images/zwavejs-ui-gateway-configuration.jpg)

Sans le type de payload et les événements Z-Wave, aucun état d'appareil
n'arrivera jusqu'à Gladys.

## Configurer l'intégration

Dans Gladys, ouvrez l'onglet **Configuration** de l'intégration :

1. **URL du broker MQTT** — par exemple `mqtt://192.168.1.10:1883`.
2. **Utilisateur / mot de passe MQTT** — à laisser vides pour un broker
   anonyme.
3. Enregistrez.

Le bouton **Tester la connexion** vérifie le lien : il indique le broker
atteint et le nombre de nœuds Z-Wave visibles.

## Ajouter vos appareils

Ouvrez l'onglet **Découverte** : chaque nœud Z-Wave non virtuel y apparaît,
avec les fonctionnalités que cette intégration sait interpréter. Choisissez une
pièce, ajustez le nom, et créez les appareils souhaités. **Scanner** demande à
Z-Wave JS UI une liste de nœuds fraîche — utile juste après avoir inclus un
nouvel appareil.

Un appareil que vous créez est renseigné immédiatement à partir des dernières
valeurs connues : il n'attend pas le réveil d'un capteur sur pile pour afficher
quelque chose.

## Appareils supportés

Les fonctionnalités sont déduites des command classes Z-Wave exposées par le
nœud :

| Command class                 | Ce que vous obtenez dans Gladys                              |
| ----------------------------- | ------------------------------------------------------------ |
| Binary Switch                 | interrupteur on/off                                          |
| Multilevel Switch (variateur) | luminosité, on/off, « restaurer l'état précédent »           |
| Multilevel Switch (volet)     | position du volet, ouvrir/fermer/stop                        |
| Binary Sensor / Alarm Sensor  | mouvement, fumée, CO, CO₂, fuite, ouverture, température     |
| Notification                  | ouverture de porte/fenêtre, alarme fumée, alarme CO          |
| Multilevel Sensor             | température, luminosité, puissance                           |
| Meter                         | énergie, puissance, tension, courant                         |
| Central Scene                 | appuis de bouton (simple, double, triple, maintenu, relâché) |
| Battery                       | niveau et indicateur de batterie faible                      |
| Thermostat Mode               | mode : arrêt, chauffage, climatisation, automatique          |
| Thermostat Setpoint           | consignes de chauffage, de climatisation et d'économie       |
| Thermostat Operating State    | état réel : au repos, en chauffe, en refroidissement         |

### Thermostats

Un thermostat Z-Wave expose jusqu'à trois consignes distinctes — chauffage,
climatisation et économie d'énergie — et chacune devient une fonctionnalité de
température indépendante dans Gladys. Le **mode** dit ce que l'appareil doit
faire, l'**état de fonctionnement** dit ce qu'il fait réellement : un
thermostat en mode Chauffage passe au repos une fois la pièce à température.

Une limite à connaître : le mode Z-Wave « Energy Save Heat » n'a pas
d'équivalent dans Gladys. Il est donc **remonté comme Chauffage** — ce que fait
l'appareil est exact — mais si vous sélectionnez Chauffage depuis Gladys, le
thermostat quitte le mode économie pour le chauffage normal. La température
d'économie, elle, reste réglable via sa propre consigne.

Les modes proposés dans l'interface sont Arrêt, Chauffage, Climatisation et
Automatique. Z-Wave n'indiquant pas de façon fiable les modes réellement
supportés par un appareil, un thermostat qui ne sait que chauffer affichera
quand même Climatisation et Automatique, et les ignorera.

Un nœud exposant autre chose apparaît quand même dans la Découverte — seules
les fonctionnalités ci-dessus sont créées.

## En cas de problème

**Rien n'apparaît dans la Découverte.** Regardez le statut dans l'onglet
Configuration. S'il indique que le broker est injoignable, l'URL ou les
identifiants sont erronés. S'il est connecté mais qu'aucun nœud n'apparaît,
reprenez la section « Configurer Z-Wave JS UI » : le champ **Name** doit valoir
`zwave-js-ui` et **Prefix** `zwave`, faute de quoi l'intégration écoute des
topics que personne n'alimente.

**Un appareil ne se met plus à jour.** Z-Wave JS UI fait référence :
vérifiez d'abord que le nœud y est bien vivant.

**« State budget exhausted » dans les logs.** Gladys accepte 300 états par
minute et par intégration. Un réseau très bavard (compteurs d'énergie
rapportant toutes les quelques secondes) peut dépasser cette limite :
l'intégration conserve alors la première et la dernière valeur de chaque
fonctionnalité et abandonne les intermédiaires. La vraie correction consiste à
réduire la fréquence de report des appareils les plus bavards dans
Z-Wave JS UI.

Passez `LOG_LEVEL=debug` pour des logs détaillés, consultables dans l'onglet
**Logs** de l'intégration.

## Migrer depuis l'intégration Z-Wave JS UI intégrée

Gladys embarque un service `zwavejs-ui` natif. Cette intégration externe le
remplace et produit **les mêmes appareils, fonctionnalités, catégories, unités
et noms** : votre historique, vos scènes et vos dashboards peuvent donc suivre.

1. Installez et configurez cette intégration.
2. Dans l'onglet **Découverte**, créez les appareils correspondant à ceux que
   vous possédez déjà.
3. Migrez chaque appareil : l'opération déplace son historique et réécrit les
   références dans vos scènes et vos dashboards. Tant que l'intégration native
   n'est pas marquée comme dépréciée dans Gladys, la migration n'a pas encore
   de bouton — appelez l'API directement, une fois par appareil :

   ```
   POST /api/v1/device/<selector-appareil-interne>/migrate
   {
     "destination_device_selector": "<selector-nouvel-appareil>",
     "features_mapping": {
       "<selector-feature-source>": "<selector-feature-destination>"
     }
   }
   ```

   Les deux appareils exposent la même liste de fonctionnalités dans le même
   ordre : la correspondance est donc du un pour un.

4. Une fois tous les appareils migrés, désactivez l'intégration native.

La migration supprime l'appareil source : faites-la une fois satisfait du
nouveau.
