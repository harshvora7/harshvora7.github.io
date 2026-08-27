# PawnHub, a chess engine in C++

*How I taught a computer to play chess starting from nothing, and what I learned about search, memory, and the strange trick of making a machine look like it is thinking. Written for someone who likes chess and has never written an engine.*

## Why build a chess engine

Writing a chess engine is a rite of passage, and I wanted to see if I could make one strong enough to beat me. It is a wonderful project because it forces together so many things at once. You need careful data structures to hold a board, precise logic to obey every rule, a search that looks many moves ahead without drowning in possibilities, and a sense of what a good position even is. Get any one of those wrong and the whole thing plays like a beginner or falls over entirely. PawnHub is the result, a C++ engine that now plays at around eighteen hundred Elo and that you can sit down and play against in a browser.

## Teaching the rules first

The unglamorous truth is that most of the early work has nothing to do with playing well. It is just teaching the machine the rules, exactly, with no shortcuts. I had to decide how to store a position, how to list every legal move from it, and how to handle all the awkward corners of chess that people forget are complicated. Castling has its own conditions. En passant is a capture that only exists for one move. A pawn reaching the far rank turns into another piece. And no move is legal if it leaves your own king in check, which means every candidate move has to be checked against that rule before it counts.

The way you know your move generation is correct is a test called perft. You count how many distinct positions exist after a fixed number of moves from the start, and you compare that count against known correct values that people have verified to enormous depths. If your number matches theirs exactly, your rules are right. If it is off by even one, you have a bug hiding somewhere, and you go find it. Getting those counts to line up was the real foundation of everything that came later, because a search built on broken rules is worse than useless.

## Making it think, search

Once the engine knew the rules, it needed to look ahead. The classic idea is to imagine every move you could make, then every reply, then every reply to that, building a tree of possibilities, and to assume that both players always choose the line that is best for them. Your best move is the one that leaves you in the strongest position after the opponent does their worst. Done naively this is hopeless, because the tree of chess positions explodes far too fast to search more than a few moves deep.

The trick that makes it practical is called alpha beta pruning. As you search, you keep track of how good a line you have already found, and the moment a branch proves it cannot possibly beat what you already have, you stop exploring it. Whole swaths of the tree get thrown away without ever being looked at, and the deeper you can prune, the deeper you can see. That pruning is the single reason an engine can look many moves ahead in a reasonable amount of time.

## Knowing a good position from a bad one, evaluation

Searching ahead only helps if the engine can tell a good position from a bad one when it stops looking. That judgment lives in the evaluation function, and it is the engine's taste. The simplest ingredient is material, just adding up who has more pieces and weighting them sensibly, since a queen is worth far more than a pawn. On top of that comes position. A knight in the center of the board is worth more than one stranded in a corner, so each piece earns a small bonus or penalty depending on where it sits. Stack up enough of these small judgments and the engine starts to prefer positions that a decent human would also prefer, which is exactly what you want it reaching for as it searches.

## Remembering what it already saw, transposition tables and Zobrist hashing

Here is a beautiful fact about chess. The same position can be reached by many different orders of moves. Play the moves in one sequence or another and you can end up at the identical board. A naive search does not notice, and happily analyzes that same position from scratch every single time it stumbles onto it, which is an enormous waste.

The fix is to remember. I gave the engine a big table where it stores positions it has already evaluated along with what it found, so that when it reaches a position it has seen before it can look up the answer instead of redoing the work. The clever part is how you look a position up quickly. Every position gets boiled down to a single number called a Zobrist hash, built by combining random values assigned to each piece on each square. Two identical positions always produce the same number, so that number becomes the key into the table. This memory, the transposition table, is one of the biggest speedups in the whole engine, because it turns mountains of repeated work into a quick lookup.

## Searching smarter, move ordering

Alpha beta pruning has a secret. It works far better when you happen to try the good moves first, because a strong move found early lets you prune everything weaker much sooner. So it is worth spending effort to guess which moves are promising before you search them. Captures of valuable pieces are a good place to start. Moves that worked well in similar positions elsewhere in the tree are another. By ordering the moves so the likely best ones come first, the engine prunes far more aggressively and searches noticeably deeper in the same amount of time. It is a strange and satisfying idea, that guessing the answer before you compute it makes computing it faster.

## Talking to the world, and putting it online

An engine is not much fun if it only talks to itself, so I made PawnHub speak the standard language that chess programs use, called UCI. Speaking that protocol means the engine can plug into any of the common chess interfaces, take a position, think, and hand back its move, the same way the famous engines do. From there I put it online so anyone can play it in a browser without installing anything, which is where the name lives now, out in the open and ready for a game.

## Where it stands and what is next

As it is, PawnHub plays at roughly eighteen hundred Elo, which is a solid club player, good enough to punish loose play and to beat me on a bad day. There is plenty of road left. A richer evaluation that understands pawn structure and king safety would sharpen its judgment. Deeper and more selective search would let it see further into sharp positions. Endgame tables would let it play perfectly once few pieces remain. But even where it stands, it does the thing I set out to build, which is to sit across from a person, look ahead, and play real chess.
