---
title: Kitchen sink
tags: [test, marginalia]
aliases: ["Stress test"]
---
# Kitchen sink

An opening paragraph with **bold text**, *italic text*, ***both at once***, ~~struck out~~, ==a plain highlight==, `inline code`, and a [markdown link](https://example.com/path?q=1) plus a [[Wikilink target|wikilink alias]] and a bare [[Wikilink target]].

## Lists

- First bullet item with some words
- Second bullet item
    - Nested bullet under the second
    - Another nested bullet with `code`
- Third bullet item
1. Ordered one
2. Ordered two with **emphasis**
- [ ] An unchecked task item
- [x] A checked task item

## Quotes and callouts

> A plain blockquote line that goes on for a little while.
> Its second line continues the same quote.

> [!note] Callout title here
> The body of the callout has text worth annotating.
> - A list inside the callout

## Table

| Column one | Column two | Column three |
| ---------- | ---------- | ------------ |
| alpha cell | beta cell  | gamma cell   |
| delta cell | epsilon    | zeta cell    |

## Math

Euler's identity $e^{i\pi} + 1 = 0$ sits inline in this sentence.

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

The display formula above is followed by this sentence.

## Code

```python
def fibonacci(n):
    return n if n < 2 else fibonacci(n - 1) + fibonacci(n - 2)
```

Text right after the code block.

## Media and embeds

![[Pasted image 20261026134048.png]]

An image above, and an external image here: ![alt text](https://example.com/image.png) in the middle of a line.

## Footnotes, comments and HTML

A sentence with an ordinary footnote.[^cite] And an inline footnote^[This is inline.] in the middle.

A comment %%hidden from readers%% sits in this line, and <span style="color: red">some red HTML text</span> too.

<div>
A raw HTML block with words inside.
</div>

## Repetition and unicode

The cat sat on the mat. The dog sat on the log. The cat sat on the mat again.

Emoji 🎉 and accents — café, naïve, Zürich — and CJK 漢字かな交じり文 in one line.

#tag-in-text and a final line that ends without punctuation

---

Last paragraph after a horizontal rule.

[^cite]: An ordinary citation, *Source*, 2024.
