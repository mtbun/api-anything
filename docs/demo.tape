# Regenerate the README demo from the repository root: vhs docs/demo.tape
# Needs: vhs, jq, `npm link` in this repository, and Chromium for Playwright.

Output docs/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

Hide
Type "R=$PWD; D=$(mktemp -d); cp $R/examples/demo-app/steps.ts $D/; cd $D; (npx --prefix $R tsx $R/examples/demo-app/server.ts 4010 >/dev/null 2>&1 &); export PS1='$ '; sleep 2; clear"
Enter
Sleep 4s
Show

Type "# 1. Record: a script signs in to the demo app and clicks around"
Enter
Type "api-anything record http://localhost:4010 --script steps.ts --out demo.har"
Enter
Sleep 8s

Type "clear; # 2. What did the web app call behind the scenes?"
Enter
Type "api-anything openapi demo.har --out demo.json; api-anything session demo.har 2>/dev/null; api-anything ops demo.json"
Enter
Sleep 6s

Type "clear; # 3. Call it like an API"
Enter
Type "api-anything call demo.json listEmployees --status active | jq '.items[0]'"
Enter
Sleep 4s
Type "api-anything call demo.json getEmployee --employeeId abc"
Enter
Sleep 4s

Type "clear; # 4. How do the calls connect?"
Enter
Type "api-anything deps demo.har | tail -6"
Enter
Sleep 6s
