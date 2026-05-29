# contracts/distributions.py

import numpy as np


def clamp(x, xmin, xmax):
    return max(xmin, min(x, xmax))


def normal_clamped(rng, mean, std, xmin, xmax):
    return clamp(rng.normal(mean, std), xmin, xmax)


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def latent_z(rng, mean, std):
    return rng.normal(mean, std)