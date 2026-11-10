#!/usr/bin/env python3
"""Writes data/curation.json: genre tree, genres + blurb for every read book, and recommendations.

This is the "refresh" step Claude performs: edit the tables below (new series, new recommendations),
then run this script. `because` lists Goodreads book ids of books you've read.

    python scripts/make_curation.py
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_graph import ROOT, load_read_books, load_queue_books

TREE = {
    "Fantasy": ["Epic Fantasy", "Grimdark", "Dark Fantasy", "Adventure Fantasy", "Urban Fantasy",
                "Comic Fantasy", "Romantasy", "Global Fantasy", "Mythic & Literary Fantasy", "Cozy Fantasy"],
    "Science Fiction": ["Sci-Fi Adventure", "Military Sci-Fi", "Dystopian", "Science Fantasy", "LitRPG & Gamelit"],
    "Crime & Thriller": ["Nordic Noir", "Action Thriller", "Classic Mystery"],
    "Literary & Classics": ["Magical Realism", "Satire & Classics", "Western", "Comic Novel", "Philosophy"],
}

# series name -> (genres, blurb)
SERIES = {
    "Dungeon Crawler Carl": (["LitRPG & Gamelit"], "A washed-up ex-cop, his ex-girlfriend's cat and a deadly alien game show that turns Earth into a dungeon."),
    "The Dresden Files": (["Urban Fantasy"], "Harry Dresden, Chicago's only professional wizard, takes on vampires, fae and worse, with snark."),
    "The Empyrean": (["Romantasy"], "A reluctant cadet, a dragon-rider war college and a very dangerous romance."),
    "The Band": (["Adventure Fantasy", "Comic Fantasy"], "Retired mercenary legends get the band back together for one last, absurd job."),
    "Hierarchy": (["Epic Fantasy"], "A boy adopted into a ruthless magical ruling class sets out to bring it down from within."),
    "The Licanius Trilogy": (["Epic Fantasy"], "A fugitive in a world where magic is gone, and a prophecy he doesn't believe in."),
    "The Cinder Spires": (["Adventure Fantasy"], "Airships, aristocrats and talking cats in a world of towering spires above a deadly surface."),
    "The Dandelion Dynasty": (["Epic Fantasy", "Global Fantasy"], "A rebellion against an empire, told in the 'silkpunk' style, with gods who play favourites."),
    "The Murderbot Diaries": (["Sci-Fi Adventure"], "A security android that has hacked its own governor module and would really rather watch TV."),
    "The Faithful and the Fallen": (["Epic Fantasy", "Grimdark"], "Norse-flavoured saga of giants, prophecy and brutal war for a divided land."),
    "The Green Bone Saga": (["Global Fantasy"], "Two rival clans fight for an island city whose warriors draw power from magical jade."),
    "1Q84": (["Magical Realism"], "Two people slip into a second, subtly wrong 1984 with two moons in the sky."),
    "The Kingkiller Chronicle": (["Epic Fantasy"], "An innkeeper recounts the legend of Kvothe, the gifted young man behind the myths."),
    "Farseer Trilogy": (["Epic Fantasy"], "A royal bastard trained as an assassin in a kingdom besieged by Raiders."),
    "Rivers of London": (["Urban Fantasy"], "A London constable discovers that magic is real and that the Met has a department for it."),
    "The Burning": (["Global Fantasy", "Epic Fantasy"], "A young man from a conquered people trains for vengeance in a society built around war."),
    "The Demon Cycle": (["Epic Fantasy", "Dark Fantasy"], "Every night demons rise from the ground; only wards, and a few warriors, keep them out."),
    "The Stormlight Archive": (["Epic Fantasy"], "Highstorms, spren and Knights Radiant as a world heads toward its Desolation."),
    "Ready Player One": (["LitRPG & Gamelit", "Dystopian"], "A teenager hunts the ultimate Easter egg in a sprawling virtual world."),
    "Ender's Saga": (["Military Sci-Fi"], "A child is trained as a commander in a war against an alien enemy."),
    "Millennium": (["Nordic Noir"], "A disgraced journalist and a brilliant hacker unearth Sweden's darkest secrets."),
    "The Broken Earth": (["Science Fantasy"], "On a continent that ends every few centuries, a mother hunts the man who murdered her son."),
    "Lonesome Dove": (["Western"], "Two retired Texas Rangers drive a cattle herd north in an epic of friendship and loss."),
    "The Age of Madness": (["Grimdark"], "The First Law world a generation later, with industry, revolution and a new set of terrible people."),
    "The First Law": (["Grimdark"], "A torturer, a barbarian and a vain swordsman are dragged into a war for the North."),
    "The Grim Company": (["Grimdark"], "A band of broken heroes, a doomed city and a tyrant with a dark army."),
    "The Witcher": (["Dark Fantasy"], "Geralt of Rivia, monster-slayer, and the girl whose fate is tied to his."),
    "Discworld": (["Comic Fantasy"], "Pratchett's flat world on the back of four elephants and a turtle: satire disguised as fantasy."),
    "Hundred-Year-Old Man": (["Comic Novel"], "A man climbs out of his window on his 100th birthday and drifts into an absurd adventure."),
    "Sean King & Michelle Maxwell": (["Action Thriller"], "Two ex-Secret Service agents turned private investigators, chased across Washington conspiracies."),
    "Codex Alera": (["Epic Fantasy"], "A boy without magic in a land where everyone commands the furies."),
    "Mistborn": (["Epic Fantasy"], "A heist against a god-emperor, and later a frontier-western spin on the same world."),
    "Elantris": (["Epic Fantasy"], "A once-glorious city of gods is now a plague-ridden ruin."),
    "The Song of the Shattered Sands": (["Epic Fantasy", "Global Fantasy"], "A desert city of rival houses, fighting pits and a young man hunting his mother's killers."),
    "The Daevabad Trilogy": (["Global Fantasy", "Epic Fantasy"], "A con artist in 18th-century Cairo is pulled into the politics of a djinn kingdom."),
    "Empire of the Vampire": (["Dark Fantasy", "Grimdark"], "A world without sun, ruled by vampires, and the hunter who bears their curse."),
    "Red Rising Saga": (["Military Sci-Fi", "Dystopian"], "A miner on Mars infiltrates the golden elite who rule the solar system."),
    "Kingdom of Oak and Steel": (["Epic Fantasy"], "A young sword-for-hire and the ancient forces gathering against his homeland."),
    "Of Blood and Bone": (["Epic Fantasy", "Grimdark"], "Gwynne's Norse-flavoured epic, centuries after the Faithful and the Fallen."),
    "Cerulean Chronicles": (["Cozy Fantasy"], "A caseworker sent to a magical orphanage on a remote island finds a found family."),
    "The Bloodsworn Saga": (["Epic Fantasy", "Grimdark"], "Viking-age gods, oath-breakers and a band of outcasts in a savage northern land."),
    "Hoid's Travails": (["Epic Fantasy", "Comic Fantasy"], "A fairy-tale adventure on a sea of spores, narrated with Sanderson's sly wit."),
    "Sherlock Holmes": (["Classic Mystery"], "The detective's first case: the origin of the world's most famous partnership."),
    "The Wheel of Time": (["Epic Fantasy"], "Three villagers are swept up in a world-spanning struggle against the Dark One."),
    "Malazan Book of the Fallen": (["Epic Fantasy", "Grimdark"], "Soldiers, mages and ascendants in the sprawling Malazan Empire."),
    "'Mancer": (["Urban Fantasy", "Comic Fantasy"], "Video-game magic and a wry take on the urban-fantasy underworld."),
}
BY_TITLE = {  # standalone books
    "Warbreaker": (["Epic Fantasy"], "Two princesses, a god-king and a magic system powered by colour."),
    "Best Served Cold": (["Grimdark"], "A poisoner's revenge tour across Styria."),
    "The Heroes": (["Grimdark"], "Three days of one battle, told from every side."),
    "Red Country": (["Grimdark"], "A frontier western in Abercrombie's world: a woman hunts her stolen siblings."),
    "Sharp Ends": (["Grimdark"], "Short stories from the world of the First Law."),
    "The Devils": (["Grimdark", "Adventure Fantasy"], "A monk-turned-demon-hunting band: Abercrombie in new territory."),
    "Welcome to the Jungle": (["Urban Fantasy"], "A Dresden graphic novel prequel."),
    "Animal Farm": (["Satire & Classics", "Dystopian"], "Orwell's allegory of revolution betrayed."),
    "1984": (["Dystopian", "Satire & Classics"], "Big Brother, Newspeak and the memory hole."),
    "Catch-22": (["Satire & Classics"], "A wartime bombardier trapped by an unwinnable paradox of military logic."),
    "American Gods": (["Mythic & Literary Fantasy"], "Old gods in a new America, on a road trip."),
    "Anansi Boys": (["Mythic & Literary Fantasy", "Comic Fantasy"], "A man discovers his father was a god and gets a brother he never knew."),
    "Norse Mythology": (["Mythic & Literary Fantasy"], "The Norse myths retold by Gaiman."),
    "Jonathan Strange & Mr Norrell": (["Mythic & Literary Fantasy"], "Two magicians bring English magic back during the Napoleonic wars."),
    "Piranesi": (["Mythic & Literary Fantasy"], "A man lives in an endless house of statues and tides, and something is not as it seems."),
    "Project Hail Mary": (["Sci-Fi Adventure"], "A lone astronaut wakes with no memory and a world to save."),
    "The Wood at Midwinter": (["Mythic & Literary Fantasy"], "A short winter tale from the world of Jonathan Strange."),
    "The Ladies of Grace Adieu and Other Stories": (["Mythic & Literary Fantasy"], "Faerie-touched stories from Susanna Clarke's England."),
    "Meditations": (["Philosophy"], "Marcus Aurelius's private notes on how to live well."),
    "The Ocean at the End of the Lane": (["Mythic & Literary Fantasy"], "A short, haunting fable of childhood and the uncanny."),
    "A Study in Scarlet": (["Classic Mystery"], "Holmes and Watson's first case."),
    "Galapagos": (["Satire & Classics"], "Vonnegut's million-year view of humanity, narrated from the far future."),
    "Kafka on the Shore": (["Magical Realism"], "A runaway boy and a man who talks to cats, in twin narratives."),
}

# (slug, title, author, year, genres, because (goodreads ids), reason)
RECS = [
 ("black-company", "The Black Company", "Glen Cook", 1984, ["Grimdark", "Adventure Fantasy"], ["944073", "18656031", "9300768"],
  "The soldier's-eye ancestor of grimdark: a weary mercenary company with no illusions, the war-is-hell tone of The Heroes and Baptism of Fire."),
 ("prince-of-thorns", "Prince of Thorns", "Mark Lawrence", 2011, ["Grimdark"], ["944076", "2315892"],
  "A brutal, charismatic young warlord with a Best Served Cold-style grudge, in a lean, fast book."),
 ("locke-lamora", "The Lies of Locke Lamora", "Scott Lynch", 2006, ["Adventure Fantasy", "Dark Fantasy"], ["2315892", "186074", "34880234"],
  "Sharp banter, a vivid city and a mean streak: Abercrombie's cynicism with the heist energy of Kings of the Wyld."),
 ("blacktongue", "The Blacktongue Thief", "Christopher Buehlman", 2021, ["Adventure Fantasy", "Dark Fantasy"], ["34880234", "186074"],
  "A debt-ridden thief joins a band of killers with a darkly funny voice: Kings of the Wyld meets Kvothe's storytelling."),
 ("senlin", "Senlin Ascends", "Josiah Bancroft", 2013, ["Adventure Fantasy"], ["24876258", "14201"],
  "An absurd, brilliant vertical world: Cinder Spires-style invention with Strange & Norrell's dry wit."),
 ("poppy-war", "The Poppy War", "R.F. Kuang", 2018, ["Global Fantasy", "Grimdark"], ["41716919", "41952489"],
  "A war-college story that becomes an unflinching look at atrocity; rooted in China's history like Jade War, as vengeful as The Rage of Dragons."),
 ("baru", "The Traitor Baru Cormorant", "Seth Dickinson", 2015, ["Global Fantasy", "Epic Fantasy"], ["18952341", "43587154"],
  "Empire, economics and sacrifice: the strategic cunning of The Grace of Kings with a ruthless edge."),
 ("got", "A Game of Thrones", "George R.R. Martin", 1996, ["Epic Fantasy", "Grimdark"], ["15750692", "944073"],
  "Political, bloody and character-driven; the genre's foundational text for fans of Gwynne and Abercrombie."),
 ("al-rassan", "The Lions of Al-Rassan", "Guy Gavriel Kay", 1995, ["Global Fantasy", "Epic Fantasy"], ["18952341", "25300956"],
  "A historical-flavoured tale of love and loyalty on opposite sides of a war, with the emotional pull of Robin Hobb."),
 ("way-of-shadows", "The Way of Shadows", "Brent Weeks", 2008, ["Dark Fantasy", "Epic Fantasy"], ["77197", "3428935"],
  "An orphan trained as an assassin: Assassin's Apprentice's hook at The Warded Man's pace."),
 ("emperors-blades", "The Emperor's Blades", "Brian Staveley", 2014, ["Epic Fantasy"], ["58416952", "22878967"],
  "Three heirs, one murdered emperor and a monastery of monks: intrigue and training in the vein of Hierarchy."),
 ("sword-kaigen", "The Sword of Kaigen", "M.L. Wang", 2019, ["Global Fantasy", "Epic Fantasy"], ["41952489", "51057191"],
  "A family of warriors facing invasion, with the martial intensity of The Burning and the clan drama of Jade Legacy."),
 ("blood-song", "Blood Song", "Anthony Ryan", 2011, ["Epic Fantasy"], ["41952489", "15750692"],
  "A gifted young warrior rises through a brutal order, close in spirit to The Rage of Dragons and Malice."),
 ("theft-of-swords", "Theft of Swords", "Michael J. Sullivan", 2011, ["Adventure Fantasy"], ["34880234", "24876258"],
  "Two thieves-for-hire and a lot of fun: a warm, quippy adventure like Kings of the Wyld."),
 ("gunslinger", "The Gunslinger", "Stephen King", 1982, ["Dark Fantasy"], ["256008", "13521459"],
  "A lone gunman in a ruined west: Lonesome Dove's frontier meets Red Country's grit, bent into dark fantasy."),
 ("rook", "The Rook", "Daniel O'Malley", 2012, ["Urban Fantasy", "Comic Fantasy"], ["9317452", "47212"],
  "A secret magical bureaucracy hidden in modern Britain, with Rivers of London's wry voice."),
 ("neverwhere", "Neverwhere", "Neil Gaiman", 1996, ["Urban Fantasy", "Mythic & Literary Fantasy"], ["9317452", "30165203"],
  "A hidden London beneath London, by the author of American Gods."),
 ("moon-called", "Moon Called", "Patricia Briggs", 2006, ["Urban Fantasy"], ["47212", "91477"],
  "A mechanic who is a coyote shapeshifter among werewolves: the supernatural-underworld fun of Fool Moon."),
 ("night-circus", "The Night Circus", "Erin Morgenstern", 2011, ["Mythic & Literary Fantasy"], ["14201", "50202953"],
  "A rival-magicians love story set in a circus, with the lyrical, dreamy quality of Piranesi."),
 ("starless-sea", "The Starless Sea", "Erin Morgenstern", 2019, ["Mythic & Literary Fantasy"], ["50202953", "6443834"],
  "A book that leads to a buried library under the world: Piranesi's strangeness with 1Q84's layered stories."),
 ("circe", "Circe", "Madeline Miller", 2018, ["Mythic & Literary Fantasy"], ["37903770", "50202953"],
  "The witch of the Odyssey, told lyrically; mythology as intimate fiction."),
 ("serpent-wings", "The Serpent and the Wings of Night", "Carissa Broadbent", 2023, ["Romantasy"], ["61431922", "209439446"],
  "Deadly trials, vampire politics and a slow-burn romance, for readers who loved Fourth Wing."),
 ("acotar", "A Court of Thorns and Roses", "Sarah J. Maas", 2015, ["Romantasy"], ["61431922"],
  "The romantasy blueprint: high stakes, fae courts and a fast, addictive plot."),
 ("good-omens", "Good Omens", "Terry Pratchett & Neil Gaiman", 1990, ["Comic Fantasy"], ["64216", "30165203"],
  "Pratchett's wit and Gaiman's myth-mashing on the end of the world."),
 ("princess-bride", "The Princess Bride", "William Goldman", 1973, ["Comic Fantasy", "Adventure Fantasy"], ["34497", "34880234"],
  "Swashbuckling and satire in a single book, with the same loving mockery as Discworld."),
 ("children-time", "Children of Time", "Adrian Tchaikovsky", 2015, ["Sci-Fi Adventure"], ["32758901", "19161852"],
  "A colony of uplifted spiders and a dying humanity: big ideas with Murderbot's humanity and Jemisin's scale."),
 ("memory-empire", "A Memory Called Empire", "Arkady Martine", 2019, ["Sci-Fi Adventure"], ["32758901", "18952341"],
  "A court-intrigue space opera about language and empire, with the politics of The Grace of Kings."),
 ("ancillary-justice", "Ancillary Justice", "Ann Leckie", 2013, ["Sci-Fi Adventure"], ["32758901", "19161852"],
  "An AI in a single body seeks revenge: a thoughtful companion to Murderbot."),
 ("leviathan-wakes", "Leviathan Wakes", "James S. A. Corey", 2011, ["Sci-Fi Adventure"], ["32758901", "375802"],
  "Noir detective meets space opera, with war and politics on a solar-system scale."),
 ("dune", "Dune", "Frank Herbert", 1965, ["Science Fantasy", "Sci-Fi Adventure"], ["58416952", "7235533"],
  "Politics, prophecy and ecology on a desert world: Stormlight's scope with The Will of the Many's intrigue."),
 ("forever-war", "The Forever War", "Joe Haldeman", 1974, ["Military Sci-Fi"], ["375802"],
  "The grown-up, bitter counterpart to Ender's Game."),
 ("snow-crash", "Snow Crash", "Neal Stephenson", 1992, ["LitRPG & Gamelit", "Dystopian"], ["9969571"],
  "The cyberpunk original of virtual worlds, a pizza-delivering samurai hero and all."),
 ("hitchhikers", "The Hitchhiker's Guide to the Galaxy", "Douglas Adams", 1979, ["Sci-Fi Adventure", "Comic Novel"], ["64216", "211721806"],
  "Absurdist space comedy that would sit comfortably next to Discworld and Dungeon Crawler Carl."),
 ("hwfwm", "He Who Fights with Monsters", "Shirtaloon", 2017, ["LitRPG & Gamelit"], ["211721806", "220772908"],
  "A modern man reborn in a world with a leveling system: progression fantasy with humour."),
 ("cradle", "Unsouled", "Will Wight", 2016, ["LitRPG & Gamelit", "Adventure Fantasy"], ["211721806", "22878967"],
  "Fast, propulsive power-progression fantasy, the first book of Cradle."),
 ("brave-new-world", "Brave New World", "Aldous Huxley", 1932, ["Dystopian"], ["40961427", "170448"],
  "The pleasure-numbed counterpart to 1984's brute force."),
 ("fahrenheit", "Fahrenheit 451", "Ray Bradbury", 1953, ["Dystopian"], ["40961427"],
  "A fireman who burns books starts to read them."),
 ("parable-sower", "Parable of the Sower", "Octavia E. Butler", 1993, ["Dystopian", "Science Fantasy"], ["19161852", "40961427"],
  "A visionary teenager in a collapsing America; the same urgency as The Broken Earth."),
 ("slaughterhouse", "Slaughterhouse-Five", "Kurt Vonnegut", 1969, ["Satire & Classics"], ["168668", "170448"],
  "War as absurd, tragic comedy: Catch-22's brother."),
 ("master-margarita", "The Master and Margarita", "Mikhail Bulgakov", 1967, ["Satire & Classics", "Magical Realism"], ["168668", "14201"],
  "The Devil visits Soviet Moscow: satire, fantasy and romance in one."),
 ("blood-meridian", "Blood Meridian", "Cormac McCarthy", 1985, ["Western"], ["256008", "13521459"],
  "The darkest western ever written, for readers of Lonesome Dove and Red Country."),
 ("true-grit", "True Grit", "Charles Portis", 1968, ["Western", "Comic Novel"], ["256008"],
  "A fourteen-year-old hires a U.S. marshal to avenge her father: a witty, clear-eyed western."),
 ("sisters-brothers", "The Sisters Brothers", "Patrick deWitt", 2011, ["Western", "Comic Novel"], ["256008", "13521459"],
  "Two hired killers on the Gold Rush trail, with black humour."),
 ("wind-up-bird", "The Wind-Up Bird Chronicle", "Haruki Murakami", 1994, ["Magical Realism"], ["6443834", "7717482"],
  "Often considered Murakami's masterpiece: a missing cat, a missing wife and a well."),
 ("hundred-years", "One Hundred Years of Solitude", "Gabriel García Márquez", 1967, ["Magical Realism"], ["6443834", "36578942"],
  "The landmark of magical realism, a century of a family in Macondo."),
 ("snowman", "The Snowman", "Jo Nesbø", 2007, ["Nordic Noir"], ["2429135", "5060378"],
  "Bleak Scandinavian winter, a damaged detective and a serial killer with a signature."),
 ("smilla", "Smilla's Sense of Snow", "Peter Høeg", 1992, ["Nordic Noir"], ["2429135", "25074850"],
  "A Greenlandic-Danish outsider investigates a boy's death in snowy Copenhagen."),
 ("killing-floor", "Killing Floor", "Lee Child", 1997, ["Action Thriller"], ["204276", "85306"],
  "Jack Reacher's debut: a drifter, a small town and a conspiracy."),
 ("foundryside", "Foundryside", "Robert Jackson Bennett", 2018, ["Adventure Fantasy", "Epic Fantasy"], ["2315892", "186074"],
  "A thief, a magic system built on commands and a city of merchant houses: inventive, fast and Lynch-ish."),
 ("hyperion", "Hyperion", "Dan Simmons", 1989, ["Sci-Fi Adventure"], ["7235533", "19161852"],
  "Seven pilgrims, seven stories, one terrible destination: the Canterbury Tales in space."),
 ("priory-orange-tree", "The Priory of the Orange Tree", "Samantha Shannon", 2019, ["Epic Fantasy", "Romantasy"], ["61431922", "15750692"],
  "Dragons, queens and a world-spanning conflict, standalone and complete."),
 ("gideon-ninth", "Gideon the Ninth", "Tamsyn Muir", 2019, ["Science Fantasy", "Comic Fantasy"], ["211721806", "14201"],
  "Necromancers in space, a locked-room mystery and irreverent humour, for fans of Dungeon Crawler Carl's tone."),
 ("babel", "Babel", "R.F. Kuang", 2022, ["Mythic & Literary Fantasy"], ["14201", "50202953"],
  "Dark academia in an alternate Oxford where translation is magic: Strange & Norrell's scholarly England turned political."),
 ("bourne-identity", "The Bourne Identity", "Robert Ludlum", 1980, ["Action Thriller"], ["204276", "93947"],
  "A man with no memory and lethal skills: a classic of the conspiracy thriller."),
]


# How well each recommendation suits *my read of your taste* (0-100). This is Claude's judgment,
# informed by what you rate 5 stars (grimdark, big-magic epic fantasy, Murderbot, Jade, LitRPG) and
# what you don't (romantasy, 1Q84). build_graph.py blends it with your ratings of the linked books.
FIT = {
    "black-company": 94, "prince-of-thorns": 90, "locke-lamora": 93, "blacktongue": 88, "senlin": 82,
    "poppy-war": 86, "baru": 84, "got": 85, "al-rassan": 80, "way-of-shadows": 82, "emperors-blades": 78,
    "sword-kaigen": 87, "blood-song": 91, "theft-of-swords": 74, "gunslinger": 72, "rook": 80,
    "neverwhere": 70, "moon-called": 66, "night-circus": 62, "starless-sea": 60, "circe": 66,
    "serpent-wings": 55, "acotar": 48, "good-omens": 78, "princess-bride": 72, "children-time": 85,
    "memory-empire": 80, "ancillary-justice": 78, "leviathan-wakes": 83, "dune": 84, "forever-war": 76,
    "snow-crash": 79, "hitchhikers": 76, "hwfwm": 89, "cradle": 87, "brave-new-world": 62, "fahrenheit": 60,
    "parable-sower": 70, "slaughterhouse": 68, "master-margarita": 66, "blood-meridian": 70, "true-grit": 66,
    "sisters-brothers": 72, "wind-up-bird": 55, "hundred-years": 52, "snowman": 70, "smilla": 60,
    "killing-floor": 74, "bourne-identity": 68, "foundryside": 90, "hyperion": 82, "priory-orange-tree": 80,
    "gideon-ninth": 70, "babel": 68,
}


def main():
    books = load_read_books()
    ids = {b["id"] for b in books}
    out_books, unmapped = {}, []
    queue = load_queue_books()
    for b in books + queue:
        g = SERIES.get(b["series"]) or BY_TITLE.get(b["title"]) or BY_TITLE.get(b["title"].replace("\u00e1", "a")) or BY_TITLE.get(b["title"].split(" (")[0])
        if not g:
            unmapped.append(b["title"]); continue
        out_books[b["id"]] = {"genres": g[0], "blurb": g[1]}
    recs = []
    for slug, title, author, year, genres, because, reason in RECS:
        bad = [x for x in because if x not in ids]
        assert not bad, (slug, bad)
        assert all(any(gg in v for v in TREE.values()) for gg in genres), (slug, genres)
        assert slug in FIT, f"add a FIT score for {slug}"
        recs.append({"id": "rec-" + slug, "title": title, "author": author, "year": year,
                     "genres": genres, "because": because, "reason": reason, "fit": FIT[slug]})
    for gs in [g for v in SERIES.values() for g in v[0]] + [g for v in BY_TITLE.values() for g in v[0]]:
        assert any(gs in v for v in TREE.values()), gs
    (ROOT / "data" / "curation.json").write_text(
        json.dumps({"genres": TREE, "books": out_books, "recommendations": recs}, indent=1, ensure_ascii=False), "utf8")
    print(f"{len(out_books)} books tagged, {len(recs)} recommendations")
    if unmapped:
        print("UNMAPPED:", unmapped)


if __name__ == "__main__":
    main()
