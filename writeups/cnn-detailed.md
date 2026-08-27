# Accelerating CNN Inference on a GPU

*The long version. A story about taking one small neural network's forward pass and building it every way a GPU can run it, from a first clumsy kernel to a production engine, measuring the whole way so I actually understood what was happening. Written for someone who knows a little programming and nothing about GPUs.*

## Where this started

I wanted to really understand what happens when a neural network meets a GPU. Not the textbook version, the real one, where the exact same piece of math can run a hundred times faster or slower depending only on how you write it. So I picked one small convolutional network's forward pass and set myself a goal. Build it from scratch, then build it again every other way a GPU can run it, and measure the whole thing carefully enough to say which way wins, and why.

The pipeline itself is four steps. A convolution, then a batch normalization, then a ReLU, then a max pool. If those words mean nothing to you, here is the whole idea in plain terms. The convolution slides a small window over an image and, at every position, multiplies the pixels under the window by a set of weights and adds them up. That is how a network picks up edges and textures. The batch normalization rescales those numbers so they sit in a friendly range. The ReLU throws away the negatives and keeps the positives. The max pool shrinks the image by keeping only the largest value in each little neighborhood. Stack those four and you have the guts of what a real network does thousands of times.

I started the way you always should, with the simplest thing that could possibly work. One channel at a time, a single grayscale image, and a naive kernel that does the obvious thing with no thought for speed. It was slow, but it was a place to stand. The real question, the one that shaped everything after, was simple. How many genuinely different ways can you run this on a GPU, and which one actually wins?

## Getting it to run, and learning to trust the numbers

The very first thing I built was not fast, and it was never meant to be. It was a plain version of the whole pipeline running on the CPU, slow and simple, written so that I could trust it completely. That reference became the backbone of the entire project, because a fast wrong answer is worthless, and the only way to know an answer is right is to check it against something you are already sure of.

From then on every single kernel I wrote had to prove itself against that reference before I would even glance at how fast it was. I measured the difference between the GPU result and the CPU result and demanded it be tiny. That one rule saved me more than once, and later in this story it catches a bug that would otherwise have made me celebrate a kernel that was quietly producing garbage. Trust the numbers, but earn that trust first.

## My first real idea, tiling

The naive convolution is slow for a reason that is easy to picture. Every output pixel needs to look at a little patch of the input, and neighboring output pixels look at patches that overlap almost completely. The naive kernel does not care. For each output it goes back out to the GPU's main memory and reads its whole patch again, and again, and again, with enormous overlap between neighbors. It is like a class of students each walking to the library to photocopy the same page one at a time instead of sharing a single copy.

The fix is called tiling, and the idea is to use a small patch of very fast memory that a group of threads shares. One block of threads cooperates to load a tile of the input into that shared memory once, and then every thread in the block reads what it needs from there instead of going back to slow main memory. I wrote that kernel and then swept it across a range of filter sizes, from small three by three windows up to large thirty one by thirty one ones, comparing it against the naive kernel and against cuDNN, all on a single channel.

![Single channel filter size crossover](assets/charts/01_sc_crossover.png)

The picture told a clean story. My tiled kernel beat the naive one everywhere, and the gap grew as the filter got bigger, which makes sense, because a bigger window means more overlap and more wasted reads for the naive kernel to suffer. More interesting was where the lines crossed cuDNN, which is NVIDIA's own carefully tuned library for this kind of work. For small filters my simple kernels were actually faster than that mighty library, and cuDNN only pulled ahead once the windows got large. That was my first taste of the theme that runs through everything here. There is no single fastest way. It depends on the shape of the work.

## Proving the win instead of assuming it

A faster time is evidence, but it does not tell you why something got faster, and I wanted to know why. So I brought in the profiler, NVIDIA's Nsight, which can watch a kernel run and report exactly how much data it moved and where. I pointed it at the naive and the tiled kernels and looked at two numbers. How much traffic went through the fast memory on the chip, and how much went all the way out to the slow main memory.

![On chip traffic, naive versus tiled](assets/charts/09_profiling.png)

The result was stark. Tiling cut the traffic through fast on chip memory by more than forty times, while the traffic to main memory barely changed at all. That is the whole win in one sentence. The tiled kernel was not moving less data in total, it was moving it through fast memory instead of slow memory, exactly as designed. And here is the part I am proudest of. Before I ran the profiler, I sat down and worked out on paper roughly how much the traffic should drop, purely from the geometry of the tiles. My prediction was about forty four times. The profiler measured about forty three and a half.

![Predicted versus measured traffic reduction](assets/charts/11_model_vs_measured.png)

When a number you calculated from first principles lands almost exactly on what the hardware actually did, it means you understand the machine and you are not fooling yourself. That was a good day.

## Half precision, and the bug it uncovered

The next lever was precision. Everything so far ran in normal thirty two bit floating point. Modern GPUs have special units called Tensor Cores that scream through sixteen bit math, so I added a half precision path, expecting a nice easy speedup. What I got instead was a screen full of zeros.

This is exactly where the validation habit earned its keep. The half precision output failed the check against the CPU reference immediately, so I never got to be fooled by a fast kernel that was really producing nothing. The hunt took a while. The convolution, the normalization, and the pooling all used a couple of small scaling constants, and I had carefully made those constants sixteen bit to match the sixteen bit data. That felt right and was completely wrong. The library expects those particular scaling values to stay thirty two bit even when the data they scale is sixteen bit, and getting that wrong silently zeroed the result. The same mistake was hiding in three separate places for the same reason. Once I fixed all three and told the library it was allowed to use the Tensor Cores, the numbers came back correct.

![Per layer timings at one channel](assets/charts/02_sc_perlayer.png)

With it finally working I could look at the pipeline one layer at a time on a single channel. At this tiny size my own kernels held their own and even beat the library on several of the steps, because one channel is simply too little work to justify the library's overhead. Which was a perfect setup for the next question.

## Making it a real network, many channels

A real convolutional network does not process one grayscale image. It processes stacks of feature maps, dozens or hundreds of channels deep, and every output channel mixes information from every input channel. So I rebuilt the benchmark to sweep the number of channels, from one all the way up to a hundred and twenty eight, and ran every implementation across that range.

![Every implementation across channel counts](assets/charts/03_mc_ladder.png)

The whole story turned over. At one channel my custom kernels were on top, just as before. But as the channels grew, the lines crossed and never looked back. By sixty four channels cuDNN was running around twenty five times faster than my naive kernel, and by a hundred and twenty eight the distance was even greater. Nothing about my code changed. Only the amount of work did. The library carries a fixed cost that is pure waste on a tiny problem and pure genius on a big one, because it was built to keep a large GPU completely busy, and only a large problem gives it the chance.

![When FP16 starts to win](assets/charts/04_fp16_speedup.png)

The channels also finally woke up the Tensor Cores. On a tiny problem, half precision had done nothing useful, because there was not enough work to feed those special units. Once there were enough channels, sixteen bit math pulled clearly ahead of thirty two bit, and the advantage widened as the problem grew. Half precision is not free speed you can sprinkle on anything. It is speed that shows up only when the work is big enough to actually reach the Tensor Cores.

## The trick that changes everything, convolution as a matrix multiply

Here is the idea that reframed the whole project for me. A convolution, for all its sliding windows, is secretly a matrix multiply in disguise. If you take every little patch the window ever sees and unroll each one into a column, you get a big matrix, and multiplying that matrix by your weights produces exactly the convolution result. This unrolling trick is called im2col, and the reason to bother is that matrix multiply is the single most optimized operation in all of computing. NVIDIA ships a library called cuBLAS whose only job is to multiply matrices at ferocious speed. So instead of writing a cleverer convolution, I turned the convolution into a matrix multiply and handed it to cuBLAS.

![The full custom kernel ladder at sixty four channels](assets/charts/05_ladder_bar.png)

It worked, and it was not close. Reformulating as a matrix multiply beat every direct kernel I had written, roughly ten times faster than the naive one. Seeing that was the moment the lesson clicked. To beat a hand written kernel, the answer is usually not a better hand written kernel. It is to stop writing kernels and reshape the problem into one the hardware already loves.

There is a cost to the trick, though, and it is worth being honest about. Unrolling every patch into its own column duplicates a lot of data, since neighboring patches overlap, so the unrolled matrix is far larger than the original image and has to be written out to memory and read back. When I measured it, that unrolled matrix moved around a hundred and sixty seven megabytes of traffic where the direct kernels moved only about twenty five. That is the tax you pay for the trick. And it is exactly the tax that cuDNN avoids, because cuDNN does the same matrix multiply without ever writing the unrolled data down, keeping it implicit and on the fly. That is why the library still sits ahead of my explicit version even though both are, underneath, doing a matrix multiply.

## Chasing cuDNN with a smarter kernel

Something about the earlier tiling result had been quietly bothering me. When there were many channels, my tiled kernel was not actually helping much, and on the newer GPU it was even a touch slower than the naive one. I had optimized the wrong thing. The tiling saved reads of the input image, but in a many channel convolution the real reuse is not just across nearby pixels, it is across output channels, because every output channel reads the very same input tile. My tiled kernel loaded a tile, used it for one output channel, and threw it away, then loaded it all over again for the next output channel.

So I wrote a version that fixes precisely that. Each thread computes several output channels at once from a single loaded tile, so the tile gets reused across the channels instead of being reloaded for each one. This is called coarsening, and I swept how many output channels to fold into each thread, from one up to eight.

![Coarsening factor versus speedup](assets/charts/07_coarsen_sweep.png)

Folding more output channels into each thread kept paying off up to a point, recovering the reuse the plain tiling had wasted. The honest and interesting wrinkle is that how much it helped depended on the GPU. On the older card the coarsened kernel was a clear win over both the naive and the tiled versions. On the newer, faster card the picture shifted, and the same optimization that had been a big win became a marginal one. That is a real lesson in itself. A clever trick that helps on one machine does not automatically carry over to the next, because the balance between compute and memory is different on every chip.

## Seeing the whole story in one picture, the roofline

At this point I had a pile of kernels and a pile of timings, and I wanted one picture that explained all of it. That picture is called a roofline, and it is the tool GPU people reach for to reason about performance. The idea is simple. Draw two ceilings for the machine. One is how fast it can possibly do math, and the other is how fast it can possibly move data. Then place each kernel on the plot according to how much math it does per byte it moves. If a kernel bumps against the memory ceiling it is starved for data. If it bumps against the compute ceiling it is working the math units as hard as they can go. And if it sits far below both, something is being wasted.

![The roofline](assets/charts/10_roofline.png)

![How close each implementation gets to the compute ceiling](assets/charts/12_gflops.png)

This is where I learned the most surprising thing in the whole project. My direct kernels were doing plenty of math per byte, which put them well over on the compute heavy side of the plot, far from the memory ceiling. So they were not starved for data. And yet they were reaching only a tiny fraction of the machine's peak math rate, sitting far below the compute ceiling. That combination has a specific meaning. My kernels were not slow because of memory bandwidth. They were slow because they could not keep the math units busy, wasting compute rather than waiting on data. And keeping the math units busy is exactly what a well written matrix multiply does, by carefully arranging the work so the hardware never stalls. The roofline turned a vague feeling that cuDNN was better into a precise statement of what better even meant.

## Cutting out the trips to memory, fusion

There was one more classic idea I wanted to try. Each step of the pipeline normally runs as its own separate kernel, which means the data gets written out to memory at the end of one step and read back in at the start of the next. If those steps are simple, all that writing and reading can cost more than the actual work. Fusion means folding several steps into a single kernel so the data stays on the chip and never makes the round trip. I fused the normalization and the ReLU into the convolution and measured it.

![Fusion](assets/charts/06_fusion.png)

On the cheap elementwise parts, the normalization and the ReLU, fusion was a clear win, running close to twice as fast, because for those steps the memory round trip really was most of the cost. When I fused the whole thing including the convolution, the gain mostly vanished, and for a simple reason. When one slow step dominates the total time, shaving the memory traffic off the fast steps around it barely moves the needle. That is not a failure of the idea, it is a lesson about when it matters. Fusion pays off enormously, but only once the heavy step has already been made fast, which is exactly why production systems fuse aggressively around their fast library kernels.

## The production answer, TensorRT

For the finale I wanted to see what the tools people actually deploy would do with this same network. The path there is to export the model into a portable format called ONNX and hand it to TensorRT, NVIDIA's engine that takes a whole model and compiles it into something tuned for the exact card it will run on. This is not a single kernel, it is the whole graph optimized together.

![TensorRT end to end](assets/charts/08_tensorrt.png)

The engine ran the full pipeline in about a tenth of a millisecond on the newer card, roughly four times faster than plain PyTorch running the same model. It gets there by doing everything I had been doing by hand, all at once and automatically. It fuses the steps together, it picks the best kernel for each piece, and it runs in half precision on the Tensor Cores. It was the fastest full pipeline result in the entire project, and the natural top of a ladder that began with a clumsy kernel of my own.

I want to be fair about what this comparison is and is not. It is not a fair fight between my kernels and TensorRT, and it was never meant to be. My kernels solve one operation at a time. TensorRT optimizes the entire graph as a whole, which is a fundamentally larger and easier win. The right way to read it is as the last rung of the ladder. Naive kernel, then tiling, then coarsening, then reformulating as a matrix multiply, then the tuned library, and finally the production engine that ties it all together.

## What I took away from it

If I had to compress the whole project into one sentence it would be this. To go faster, reshaping the problem beats grinding on the kernel. The single biggest jump did not come from a cleverer loop, it came from turning the convolution into a matrix multiply and letting hardware that was built for that do its job.

A few other things stuck with me. The fastest choice was never fixed, it depended entirely on the shape of the work, and a kernel that won at one channel lost badly at a hundred. The optimizations did not carry cleanly between GPUs, because the balance of compute and memory is different on every chip, so tuning is never done once and forgotten. Lower precision was not free, it only paid off when the work was large enough to reach the Tensor Cores. And the habit of checking every result against a trusted reference was not bureaucratic caution, it was the thing that caught a silent bug and kept me from believing a kernel that was producing zeros.

If I kept going, I would push the fused kernels harder now that I understand where fusion actually pays, and I would treat the roofline as a target rather than a diagnosis, aiming each kernel at a specific ceiling instead of just trying to make it faster. But as a way to actually understand what happens when a neural network meets a GPU, going the whole distance from a naive kernel to a production engine and measuring every step taught me more than any amount of reading ever could.
