using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public enum PlayerState
{
    walk,
    attack,
    interact
}
public class PlayerMovement : MonoBehaviour
{

    public PlayerState currentState;
    public float speed;
    private Rigidbody2D myRigidbody;
    private Vector3 change;
    private Animator animator;

    // Setup our player
    void Start()
    {
        // Set our default state to walking/idling
        currentState = PlayerState.walk;
        // Get our components
        animator = GetComponent<Animator>();
        myRigidbody = GetComponent<Rigidbody2D>();
        // Set our default attack direction to down
        animator.SetFloat("moveX", 0);
        animator.SetFloat("moveY", -1);
    }

    void Update()
    {
        
    }
}
