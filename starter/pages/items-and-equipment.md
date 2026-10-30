---
title: "Items and Equipment"
type: "rules"
aliases: ["Items", "Equipment", "Magic items", "Auction houses", "Auctions", "Auction house"]
---

The **Items** browser in the sidebar lists every piece of everyday equipment, every magic item, gemstone and trade good, and the goods made in Pallimustus itself, with prices, descriptions and where each one can be found. Item names in a market or an auction link straight to it.

Everyday goods are priced in gold, silver and copper. Anything magical is priced in [[Spirit Coins|spirit coins]] as well: one iron spirit coin is worth 1 gp, one bronze 100 gp and one silver 10,000 gp. See [[Markets and Prices]] for essences, stones and cores.

## Where things are sold

What a shop can sell depends on where it is. Small places sell what small places need; the rarest things gather in the great cities, and the very rarest are only ever sold at auction.

| Settlement | Magic items up to | Dearest item in the shops | Essences up to | Essences, stones and cores | Auction house |
| --- | --- | --- | --- | --- | --- |
| Village | Common | 100 gp | Common | Iron rank | No |
| Town, like [[Harrowfield]] | Uncommon | 2,000 gp | Uncommon | Mostly Iron, some Bronze | No |
| City, like [[Greenstone]] or [[Yaresh]] | Rare | 50,000 gp | Rare | Iron and Bronze, a little Silver | Yes |
| Great city, like [[Rimaros]] | Very rare | No limit | Rare | Mostly Bronze and Silver | Yes |

**Magic level.** How much magic runs through a place changes what turns up within those limits. In a low-magic place, rare goods appear about half as often, high-rank goods are scarcer still, and its auction house holds smaller sales. High-magic items are also harder to use there, because they burn through more spirit coins as fuel.

**Greenstone** is a city, but a low-magic one. Its shops can sell anything a city can, up to rare magic, but rare things are hard to find, and even a Silver-rank item is a rare sight. Its auction house holds small sales. For the best goods, people travel to Yaresh or Rimaros. Towns and villages with no auction house of their own sometimes get a travelling sale with city stock.

Goods made for a rank are sold only where crafters of that rank work: Bronze-rank goods in cities, Silver-rank goods in great cities.

## Magic item prices

A magic item's price follows its rarity. Items that are used up, like potions and scrolls, cost well under half as much.

| Rarity | Typical price |
| --- | --- |
| Common | 60 to 100 gp (60 to 100 iron) |
| Uncommon | 300 to 500 gp (3 to 5 bronze) |
| Rare | 3,000 to 5,000 gp (30 to 50 bronze) |
| Very rare | 22,000 to 39,000 gp (2 to 4 silver) |
| Legendary | 110,000 to 200,000 gp (11 to 20 silver), only at auction |
| Artifact | Never for sale |

## Goods of this world

Alongside the familiar gear, the world's crafters make things of their own. A few of the most sought after:

- **Dimensional storage.** A satchel for Iron-rankers, a bag for Bronze-rankers and a storage ring for Silver-rankers, each holding far more than it should.
- **Essence cases.** Warded boxes that carry an unabsorbed essence and hide it from anyone sensing for magic.
- **Core-powered goods.** Lamps, stoves and even carriages that run on monster cores.
- **Monster-hide armour.** Armour made from ranked monsters, lighter and tougher than steel.

## Auction houses

Auction houses are found only in cities and great cities. They sell what no shop will: rare and very rare magic items (and legendary ones in the great cities), rare and legendary essences, high-level awakening stones, lots of Bronze cores and the odd Silver core, fine gems, and one-of-a-kind finds from astral spaces and old estates.

- **The catalogue.** Each lot has an estimate, which is the house's guess at its price, and an opening bid of about half that. Lots can be inspected the day before the sale.
- **The reserve.** A seller may set a secret reserve. A lot that doesn't reach it is withdrawn.
- **Rival bidders.** Every lot draws rivals, and each has a limit they won't pass. A DC 15 Insight check while watching a rival bid gives a fair idea of how far they will go.
- **The hammer.** The highest bid when the hammer falls wins. The winner pays a 10% buyer's premium on top, in spirit coins, by sundown.

:::dm
**Running shops and auctions.** The market generator stocks its stalls from the `items` list, capped by the settlement: pick one under **Settlement**, or let it follow the place. To set what kind of settlement a location is and how much magic it has, edit its page and pick a **Settlement** and a **Magic level**, or edit `places` and `placeMagic` in the `items` list. The **Auction house** generator builds a sale with its lots, rivals and auctioneer. The DM notes hold each lot's reserve, each rival's limit and the bid that wins, and sometimes a forged lot or a shill bidder. **Win this lot** charges a party member their bid plus the premium and puts the lot on their sheet. Add items of your own to the `items` list and they appear in the browser, in shops and at auction. A wiki page of type Item with the same name as a catalogue item is linked from the browser.
:::
