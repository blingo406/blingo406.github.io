---
title: "Fubini定理及其应用"
published: 2026-07-13
category: "数学分析"
parentCategory: "数学"
tags: ["math", "数学分析", "comprehension"]
description: "从区间到Jordan可测集证明Fubini定理，并用积分换序求解累次积分。"
draft: false
---
在[[区间上黎曼积分的逼近]]中我们提到，积分本质上是一种极限，而且是重极限，想要计算积分，我们自然考虑到降维，这就引出了所谓「Fubini」定理. 
### 1.Fubini定理的证明
>[!tip] 重要想法 1.0
>先考虑区间上的情况，再推到Jordan可测集上. 

##### 1.1 区间上的情况
考虑区间上的Riemann积分，简单起见，我们先来看看二维的情况. 

>[!note] 引理1.1.1
>设区间$[a,b]=[a_{1},b_{1}]\times[a_{2},b_{2}]\subset \mathbb{R}^{2}$，$f\in \mathcal {R}[a,b]$，$\forall x \in[a_{1},b_{1}]$，$f(x, \cdot)\in \mathcal {R}[a_{2},b_{2}]$. $\varphi(x):=\int_{[a_{2},b_{2}]}f(x,y)dy$，则$\varphi \in \mathcal {R}[a_{1},b_{1}]$，且 
>$$
>\int_{[a,b]}f= \int_{[a_{1},b_{1}]}\varphi(x)dx = \int_{[a_{1},b_1]}dx \int_{[a_{2},b_{2}]}f(x,\cdot)dy 
>$$

证明：
根据[[区间上黎曼积分的逼近#^72966f|积分的逼近元]]的想法，用和逼近积分. 
因为$f\in \mathcal {R}[a,b]$，所以$\forall \varepsilon>0$，$\exists$分法$T\subset[a,b]$使得
$$
\left|\int_{[a,b]}f-S_{f}(T)\right|< \frac{\varepsilon}{2} ,\hspace{1em}\left|\int_{[a,b]}f-s_{f}(T)\right|< \frac{\varepsilon}{2}
$$
又因为$\forall x \in[a_{1},b_{1}],f(x,\cdot)\in \mathcal {R}[a_{2},b_{2}]$，所以$\forall \varepsilon>0$，存在分法$T_{2}\subset[a_{2},b_{2}]:\lambda(T_{2})<\sqrt{ \frac{\lambda(T)}{2} },\forall \eta \subset[a_{2},b_{2}]:|R(T_{2},\eta)-\int_{a_{2}}^{b_{2}}f(x,y)dy|< \frac{\varepsilon}{2(b_{1}-a_{1})}$
于是$\forall$分法$T_{1}\subset[a_{1},b_{1}]$，$\lambda(T_{1})< \sqrt \frac{ \lambda(T) }{2})$，对于分法$T_{1}\times T_{2}\subset[a,b]$，
$$
\left|\sum_{i=1}^{n} \Delta x_{i}\sum_{j=1}^{m}f(\xi_{i},\eta_{j})\Delta y_{i}- \int_{[a,b]}f\right|< \frac{\varepsilon}{2}
$$
所以 
$$
\left|\sum_{i=1}^{n} \varphi(\xi_{i})\Delta x_{i}- \int_{[a,b]}f\right|<\varepsilon
$$
故$\varphi \in \mathcal {R}[a_{1},b_{1}]$，从而公式成立. 

接下来尝试推广到$n$维：

>[!warning] 定理1.1.2 区间上的Fubini定理
>设区间$I_{1}\subset \mathbb{R}^{k}$，区间$I_{2}\subset \mathbb{R}^{m}$，如果$f\in \mathcal {R}(I_{1}\times I_{2})$，且$\forall x \in I_{1},f(x,\cdot) \in \mathcal {R}(I_{2})$，记 
>$$
>\varphi(x) = \int_{I_{2}}f(x,y)dy
>$$
>那么$\varphi \in \mathcal {R}(I_{1})$，且
>$$
>\int_{I_{1}} \varphi(x) =\int_{I_{1}} dx \int_{I_{2}} f(x,y)dy = \int_{I_{1}\times I_{2}}f 
>$$

证明过程几乎与引理1.1完全一样，只需要将$\Delta x_{i},\Delta y_{i}$换成对应的小区间，这里便不再赘述. 
##### 1.2 推广到Jordan可测闭集
我们当然可以写出一般的形式，但是为了将重积分转化成累次积分来计算，我们只这里给出两种重要的特殊形式. 

>[!note] 命题1.2.1 切条法
>设$E\subset \mathbb{R}^{n}$是Jordan可测闭集，$f\in C(E)$，如果
>$$
>E=\{ (x,y)~|~\phi_{1}(x) \leq y\leq \phi_{2}(x),x \in D,y\in \mathbb{R}\}
>$$
>其中$D\subset \mathbb{R}^{n-1},\phi_{1},\phi_{2}:D\to \mathbb{R}$. 则
>$$
>\int_{E}f = \int_{D}dx \int_{\phi_{1}(x)}^{\phi_{2}(x)}f(x,y)dy
>$$

证明：
由于$E\subset \mathbb{R}^{n}$是Jordan可测闭集，所以存在区间$[a,b]\times[c,d]\subset \mathbb{R}^{n-1}\times \mathbb{R}$，使得$f\in \mathcal {R}(a,b)\times(c,d)$，且$\forall x \in D$，$[\phi_{1}(x),\phi_{2}(x)]\subset(c,d)$. 
又$f \in C(E)$，$E$是有界闭集，所以$f$在$E$上有界，且$f \in \mathcal {R}(E)$. 于是$f$的零延拓函数$f_{E}\in \mathcal {R}([a,b]\times[c,d])$.  
因为$\forall x \in D,f(x,\cdot)\in C[\phi_{1}(x),\phi_{2}(x)]$，且$\forall x,f_{E}(x,\cdot) \in C[c,\phi(x_{1}))\cap C(\phi_{2}(x),d]$，所以$f_{E}(x,\cdot)\in \mathcal {R}[c,d]$. $I_{1}:=[a,b],I_{2}:=[c,d],I:=I_{1}\times I_{2}$，根据Fubini定理有
$$
\int_{E}f = \int_If_{E}=\int_{I_{1}}dx \int_{I_{2}}f_{E}(x,y)dy = \int_{D}dx \int_{\phi_{1}(x)}^{\phi_{2}(x)}f(x,y)dy
$$
教材中的这张图很好地展示出三维的直观. 在用切条法计算$\mathbb{R}^{3}$中Jordan可测集上Riemann积分时，先对$y$方向积分得到若干小圆柱上的积分结果，随后把这些小圆柱拼起来. 

而二维的情况要更简单一些，只需要对某一个方向积分得到一条线上的积分结果，随后将这些线拼起来. 
![切条法的三维直观](/images/math/fubini-qietiao.png)

>[!note] 命题1.2.2 切片法
>设$E\subset \mathbb{R}^{n}$是Jordan可测闭集，$f\in C(E)$，如果
>$$
>E=\{ (x,y)~|~x \in D(y),y\in[c,d]\}
>$$
>其中$\forall y\in[c,d],D(y)\subset \mathbb{R}^{n-1}$是Jordan可测闭集. 则
>$$
>\int_{E}f = \int_{c}^{d}dy \int_{D(y)}f(x,y)dx
>$$

证明：
因为$E\subset \mathbb{R}^{n}$是Jordan可测闭集，$f \in C(E)$，所以$f \in \mathcal {R}(E)$，存在区间$I=I_{1}\times I_{2}:=[\hat{c},\hat{d}]\times[a,b]\subset \mathbb{R}\times \mathbb{R}^{n-1}$使得$f$的零延拓函数$f_{E} \in \mathcal {R}(I)$，$\forall y \in [c,d],D(y)\subset[a,b]$. 
又因为$f \in C(E)$，$E$是有界闭集，所以$f$在$E$上有界，即$f_E$在$I$上有界. 由于$\forall y, f(\cdot,y) \in C(D(y))$，且$f_E(x)=0,\ \forall x \in [a,b] \setminus D(y)$，所以$f_E(\cdot,y) \in \mathcal{R}([a,b])$.  
由Fubini定理得 $$ \int_E f = \int_c^d dy \int_a^b f_E(x,y)dx = \int_c^d dy \int_{D(y)} f_E(x,y)dx$$
下面是切片法的直观图. 
![切片法的直观](/images/math/fubini-qiepian.png)

---
### 2.利用积分换序
我们先从一个问题入手，看看如何利用积分换序求解累次积分
##### 2.1 问题的引入
>[!question] 问题2.1
>计算 
>$$
>\int_{0}^{1}dy\int_{y}^{1}\sin x^{2}dx
>$$

解：
由于被积函数足够光滑，所以由Fubini定理，被积函数的二重积分存在且等于它的两个累次积分. 
因为 
$$
E=\{ (x,y)~|~  0\leq y\leq x,x \in [0,1]\}=\{ (x,y)~|~ y\leq x\leq {1},y\in[0,1] \}
$$
所以 
$$
\int_{0}^{1}dy \int_{y}^{1}\sin x^{2}dx= \int_{0}^{1}\sin x^{2}dx \int_{0}^{x}dy= \frac{{1-\cos 1}}{2}
$$
定义域具体样式由下图直观给出. 
![积分定义域](/images/math/integral-domain.png)

我们不禁要问：Why it works？How it works？

##### 2.2 积分换序的实质
我们可以看到，$\sin x^{2}$的原函数不是初等函数，它差了一个$x$的积分因子，而这种三角形区域的换序正好可以引入一个$x$，便完成了闭环. 
