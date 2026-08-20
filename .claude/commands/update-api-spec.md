Aktualisiere die Productive.io API-Spec:

1. Führe den Sync aus: `npm run spec:sync`
   (lädt die offizielle Spec von developer.productive.io; `304` = nichts geändert, dann bist du fertig)
2. Prüfe den Output (Anzahl Paths, Operations, Resource-Files)
3. Führe die Impact-Analyse aus: `npm run spec:impact`
   - Exit 1 = die neue Spec bricht etwas, das `src/api` nutzt → melde die Findings
   - Bekannte, akzeptierte Abweichungen stehen in `docs/api-spec/impact-baseline.json`
4. Lies den neuesten Eintrag in `docs/api-spec/CHANGELOG.md` und fasse die Änderungen zusammen
5. Falls es Änderungen gab, frage ob committed werden soll
