import urllib.request, json

r = urllib.request.urlopen('http://127.0.0.1:8001/patta?village=h+kalladipatty&patta=1')
data = json.loads(r.read())
owners = data['pattas'][0]['owners']

with open('verify_tamil_out.txt', 'w', encoding='utf-8') as f:
    f.write('=== PATTA 1 - H KALLADIPATTY OWNERS ===\n')
    for o in owners:
        on = o['owner_name']
        rn = o['relative_name']
        rel = o['relation']
        # Check for spaces (U+0020) in the names
        f.write('owner_name: ' + on + '\n')
        f.write('owner_name has spaces: ' + str(' ' in on) + '\n')
        f.write('owner_name repr: ' + repr(on) + '\n')
        f.write('relative_name: ' + rn + '\n')
        f.write('relative_name has spaces: ' + str(' ' in rn) + '\n')
        f.write('relative_name repr: ' + repr(rn) + '\n')
        f.write('relation: ' + rel + '\n')
        f.write('---\n')

print('Done')
